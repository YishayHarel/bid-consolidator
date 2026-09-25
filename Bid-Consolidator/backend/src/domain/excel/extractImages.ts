// Row-aware image extraction from an .xlsx: returns the photos embedded in the
// first sheet, grouped by the 0-based worksheet row they belong to and ordered
// left-to-right. Handles both floating images anchored to cells (drawing XML)
// and Excel's "Place in Cell" rich-value images. Pure function over a Buffer.
import AdmZip from 'adm-zip';
import { assertSafeXlsx } from './zipGuard.js';

export interface SheetImage { ext: string; data: Buffer }
interface Found { row: number; col: number; mediaPath: string; entry: AdmZip.IZipEntry }

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function cellRefToRC(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number.parseInt(m[2]!, 10) - 1, col: col - 1 };
}

const normMedia = (tgt: string) => 'xl/' + tgt.replace(/^\/?xl\//, '').replace(/^\/+/, '').replace(/^\.\.\//, '');

function richValueImages(read: (n: string) => string | null, zip: AdmZip, sheetBase: string): Found[] {
  const out: Found[] = [];
  const sheetXml = read(`xl/worksheets/${sheetBase}`);
  const metadata = read('xl/metadata.xml');
  const rvRel = read('xl/richData/richValueRel.xml');
  const rvRels = read('xl/richData/_rels/richValueRel.xml.rels');
  if (!sheetXml || !metadata || !rvRel || !rvRels) return out;

  const vmCells: { ref: string; vm: number }[] = [];
  for (const c of sheetXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*\bvm="(\d+)"[^>]*>/g)) {
    vmCells.push({ ref: c[1]!, vm: Number.parseInt(c[2]!, 10) });
  }
  if (!vmCells.length) return out;
  const vmSection = (metadata.match(/<valueMetadata\b[\s\S]*?<\/valueMetadata>/) ?? [''])[0];
  const vmToBlock = [...vmSection.matchAll(/<rc\b[^>]*\bv="(\d+)"/g)].map((m) => Number.parseInt(m[1]!, 10));
  const fmSection = (metadata.match(/<futureMetadata name="XLRICHVALUE"[\s\S]*?<\/futureMetadata>/) ?? [''])[0];
  const blockToRvb = [...fmSection.matchAll(/rvb\s+i="(\d+)"/g)].map((m) => Number.parseInt(m[1]!, 10));
  const rvToRid = [...rvRel.matchAll(/<rel\b[^>]*r:id="(rId\d+)"/g)].map((m) => m[1]!);
  const ridToMedia: Record<string, string> = {};
  for (const m of rvRels.matchAll(/<Relationship\b[^>]*>/g)) {
    const idm = m[0].match(/Id="([^"]+)"/)?.[1];
    const tgt = m[0].match(/Target="([^"]+)"/)?.[1];
    if (idm && tgt) ridToMedia[idm] = normMedia(tgt);
  }
  for (const { ref, vm } of vmCells) {
    const block = vmToBlock[vm - 1];
    const rv = block === undefined ? undefined : blockToRvb[block];
    const rid = rv === undefined ? undefined : rvToRid[rv];
    const mediaPath = rid ? ridToMedia[rid] : undefined;
    const entry = mediaPath ? zip.getEntry(mediaPath) : null;
    const rc = cellRefToRC(ref);
    if (entry && rc && mediaPath) out.push({ ...rc, mediaPath, entry });
  }
  return out;
}

export function extractImagesByRow(buf: Buffer): Record<number, SheetImage[]> {
  const byRow: Record<number, SheetImage[]> = {};
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') return byRow; // .xls: no embedded-image support
  assertSafeXlsx(buf);
  const zip = new AdmZip(buf);
  const read = (name: string) => {
    const e = zip.getEntry(name.replace(/^\/+/, ''));
    return e ? e.getData().toString('utf8') : null;
  };

  // Resolve the first sheet's file via the workbook relationships.
  const wbRels = read('xl/_rels/workbook.xml.rels') ?? '';
  const workbook = read('xl/workbook.xml') ?? '';
  const firstRid = workbook.match(/<sheet[^>]*r:id="(rId\d+)"/)?.[1];
  let sheetTarget = 'xl/worksheets/sheet1.xml';
  if (firstRid) {
    const m =
      wbRels.match(new RegExp(`<Relationship[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`)) ??
      wbRels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`));
    if (m?.[1]) sheetTarget = 'xl/' + m[1].replace(/^\/?xl\//, '').replace(/^\/+/, '');
  }
  const sheetBase = sheetTarget.split('/').pop()!;
  const found: Found[] = [];

  // (1) Floating images anchored to cells.
  const sheetRels = read(`xl/worksheets/_rels/${sheetBase}.rels`) ?? '';
  const drawingRaw = sheetRels.match(/Target="([^"]*drawing[^"]*\.xml)"/)?.[1];
  if (drawingRaw) {
    const name = drawingRaw.replace(/^\/+/, '').replace(/^xl\//, '');
    const drawingPath = name.startsWith('drawings/') ? `xl/${name}` : `xl/drawings/${name.split('/').pop()}`;
    const drawingXml = read(drawingPath);
    if (drawingXml) {
      const drawingRels = read(`xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`) ?? '';
      const ridToMedia: Record<string, string> = {};
      for (const rel of drawingRels.matchAll(/<Relationship\b[^>]*>/g)) {
        const idm = rel[0].match(/Id="([^"]+)"/)?.[1];
        const tgt = rel[0].match(/Target="([^"]+)"/)?.[1];
        if (idm && tgt && /image|media/i.test(tgt)) ridToMedia[idm] = normMedia(tgt);
      }
      const anchorRe = /<(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)>/g;
      for (const a of drawingXml.matchAll(anchorRe)) {
        const block = a[0];
        const fromRow = block.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/)?.[1];
        const fromCol = block.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/)?.[1];
        const rid = block.match(/r:embed="(rId\d+)"/)?.[1];
        const mediaPath = rid ? ridToMedia[rid] : undefined;
        const entry = mediaPath ? zip.getEntry(mediaPath) : null;
        if (fromRow === undefined || !entry || !mediaPath) continue;
        found.push({ row: Number.parseInt(fromRow, 10), col: Number.parseInt(fromCol ?? '0', 10), mediaPath, entry });
      }
    }
  }

  // (2) "Place in Cell" rich-value images.
  found.push(...richValueImages(read, zip, sheetBase));

  // Group by row, left-to-right, so "Our Image #1" is the leftmost photo.
  const groups: Record<number, Found[]> = {};
  for (const f of found) (groups[f.row] ??= []).push(f);
  for (const [rowKey, list] of Object.entries(groups)) {
    list.sort((a, b) => a.col - b.col);
    for (const f of list) {
      if ((f.entry.header.size || 0) > MAX_IMAGE_BYTES) continue;
      const ext = (f.mediaPath.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'png').toLowerCase();
      (byRow[Number(rowKey)] ??= []).push({ ext, data: f.entry.getData() });
    }
  }
  return byRow;
}
