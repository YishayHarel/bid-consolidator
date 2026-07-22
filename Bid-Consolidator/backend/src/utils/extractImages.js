const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function extractImagesFromExcel(filePath, outputDir) {
  const images = {};

  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Open Excel file as a zip
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    // Look for media files (images in xl/media/)
    zipEntries.forEach(entry => {
      if (entry.entryName.startsWith('xl/media/') && /\.(png|jpg|jpeg|gif|bmp)$/i.test(entry.entryName)) {
        const imageName = path.basename(entry.entryName);
        const outputPath = path.join(outputDir, imageName);

        // Extract to file
        fs.writeFileSync(outputPath, entry.getData());
        images[imageName] = outputPath;
      }
    });

    return images;
  } catch (err) {
    console.error('Error extracting images:', err);
    return {};
  }
}

// Convert an A1-style cell ref (e.g. "C13") to 0-based {row, col}.
function cellRefToRC(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

// Extract Excel "Place in Cell" rich-value images (stored via richData/metadata
// rather than drawing anchors) for the given sheet. Returns [{row, col, entry, mediaPath}].
function extractRichValueImages(readEntry, zip, sheetBase) {
  const out = [];
  try {
    const sheetXml = readEntry(`xl/worksheets/${sheetBase}`);
    const metadata = readEntry('xl/metadata.xml');
    const richValueRel = readEntry('xl/richData/richValueRel.xml');
    const richValueRelsRaw = readEntry('xl/richData/_rels/richValueRel.xml.rels');
    if (!sheetXml || !metadata || !richValueRel || !richValueRelsRaw) return out;

    // cells carrying a rich value: ref + vm (1-based value-metadata index)
    const vmCells = [];
    const cellRe = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*\bvm="(\d+)"[^>]*>/g;
    let c;
    while ((c = cellRe.exec(sheetXml))) vmCells.push({ ref: c[1], vm: parseInt(c[2], 10) });
    if (!vmCells.length) return out;

    // valueMetadata: bk[vm-1] -> rc v = futureMetadata block index
    const vmSection = (metadata.match(/<valueMetadata\b[\s\S]*?<\/valueMetadata>/) || [''])[0];
    const vmToBlock = [...vmSection.matchAll(/<rc\b[^>]*\bv="(\d+)"/g)].map(m => parseInt(m[1], 10));
    // futureMetadata XLRICHVALUE: block order -> rvb rich-value index
    const fmSection = (metadata.match(/<futureMetadata name="XLRICHVALUE"[\s\S]*?<\/futureMetadata>/) || [''])[0];
    const blockToRvb = [...fmSection.matchAll(/rvb\s+i="(\d+)"/g)].map(m => parseInt(m[1], 10));
    // richValueRel: rich-value index -> rId
    const rvToRid = [...richValueRel.matchAll(/<rel\b[^>]*r:id="(rId\d+)"/g)].map(m => m[1]);
    // rels: rId -> media path
    const ridToMedia = {};
    for (const m of richValueRelsRaw.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
      const tgt = (m[0].match(/Target="([^"]+)"/) || [])[1];
      if (id && tgt) ridToMedia[id] = 'xl/' + tgt.replace(/^\/?xl\//, '').replace(/^\/+/, '').replace(/^\.\.\//, '');
    }

    for (const { ref, vm } of vmCells) {
      const blockIdx = vmToBlock[vm - 1];
      if (blockIdx === undefined) continue;
      const rvIdx = blockToRvb[blockIdx];
      if (rvIdx === undefined) continue;
      const rid = rvToRid[rvIdx];
      const mediaPath = rid && ridToMedia[rid];
      if (!mediaPath) continue;
      const entry = zip.getEntry(mediaPath);
      const rc = cellRefToRC(ref);
      if (!entry || !rc) continue;
      out.push({ row: rc.row, col: rc.col, mediaPath, entry });
    }
  } catch (err) {
    console.error('Error extracting in-cell images:', err);
  }
  return out;
}

// Row-aware extraction: returns { [rowIndex]: [absPath, ...] } grouping each
// embedded image by the 0-based worksheet row it belongs to — both floating
// images anchored to cells (drawing XML) and "Place in Cell" rich-value images.
function extractImagesByRow(filePath, outputDir) {
  const byRow = {};
  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const zip = new AdmZip(filePath);
    const readEntry = (name) => {
      const e = zip.getEntry(name.replace(/^\/+/, ''));
      return e ? e.getData().toString('utf8') : null;
    };

    // Resolve the first sheet's target file via workbook rels.
    const wbRels = readEntry('xl/_rels/workbook.xml.rels') || '';
    const workbook = readEntry('xl/workbook.xml') || '';
    const firstSheetRid = (workbook.match(/<sheet[^>]*r:id="(rId\d+)"/) || [])[1];
    let sheetTarget = 'xl/worksheets/sheet1.xml';
    if (firstSheetRid) {
      const re = new RegExp(`<Relationship[^>]*Id="${firstSheetRid}"[^>]*Target="([^"]+)"`);
      const m = wbRels.match(re) || (wbRels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${firstSheetRid}"`)));
      if (m) sheetTarget = 'xl/' + m[1].replace(/^\/?xl\//, '').replace(/^\/+/, '');
    }
    const sheetBase = sheetTarget.split('/').pop();

    const found = [];

    // --- (1) Floating images anchored to cells (drawing XML) ---
    const sheetRels = readEntry(`xl/worksheets/_rels/${sheetBase}.rels`) || '';
    const drawingTargetRaw = (sheetRels.match(/Target="([^"]*drawing[^"]*\.xml)"/) || [])[1];
    if (drawingTargetRaw) {
      const drawingName = drawingTargetRaw.replace(/^\/+/, '').replace(/^xl\//, '');
      const drawingPath = drawingName.startsWith('drawings/') ? `xl/${drawingName}` : `xl/drawings/${drawingName.split('/').pop()}`;
      const drawingXml = readEntry(drawingPath);
      if (drawingXml) {
        const drawingBase = drawingPath.split('/').pop();
        const drawingRels = readEntry(`xl/drawings/_rels/${drawingBase}.rels`) || '';
        const ridToMedia = {};
        const relRe = /<Relationship\b[^>]*>/g;
        let rel;
        while ((rel = relRe.exec(drawingRels))) {
          const id = (rel[0].match(/Id="([^"]+)"/) || [])[1];
          const tgt = (rel[0].match(/Target="([^"]+)"/) || [])[1];
          if (id && tgt && /image|media/i.test(tgt)) {
            ridToMedia[id] = 'xl/' + tgt.replace(/^\/?xl\//, '').replace(/^\/+/, '').replace(/^\.\.\//, '');
          }
        }
        const anchorRe = /<(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)>/g;
        let anchor;
        while ((anchor = anchorRe.exec(drawingXml))) {
          const block = anchor[0];
          const fromRow = (block.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/) || [])[1];
          const fromCol = (block.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/) || [])[1];
          const rid = (block.match(/r:embed="(rId\d+)"/) || [])[1];
          if (fromRow === undefined || !rid) continue;
          const mediaPath = ridToMedia[rid];
          if (!mediaPath) continue;
          const entry = zip.getEntry(mediaPath);
          if (!entry) continue;
          found.push({ row: parseInt(fromRow, 10), col: parseInt(fromCol || '0', 10), mediaPath, entry });
        }
      }
    }

    // --- (2) In-cell "Place in Cell" rich-value images ---
    // Chain: sheet cell (ref + vm) -> metadata valueMetadata[vm-1] -> futureMetadata
    // block index -> rvb rich-value index -> richValueRel[index] -> media file.
    found.push(...extractRichValueImages(readEntry, zip, sheetBase));

    // Group by row; within a row order photos left-to-right (by column) so
    // "Our Image #1" is the leftmost photo.
    const rowGroups = {};
    found.forEach(f => { (rowGroups[f.row] = rowGroups[f.row] || []).push(f); });
    let seq = 0;
    Object.keys(rowGroups).forEach(rowKey => {
      const row = parseInt(rowKey, 10);
      rowGroups[row].sort((a, b) => a.col - b.col);
      rowGroups[row].forEach(f => {
        const ext = (f.mediaPath.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1];
        const outPath = path.join(outputDir, `row${row}-${seq++}.${ext}`);
        fs.writeFileSync(outPath, f.entry.getData());
        (byRow[row] = byRow[row] || []).push(outPath);
      });
    });
    return byRow;
  } catch (err) {
    console.error('Error extracting images by row:', err);
    return byRow;
  }
}

module.exports = { extractImagesFromExcel, extractImagesByRow };
