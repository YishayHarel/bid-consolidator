// Parse a structured quote/outbound spreadsheet into rows. Column-agnostic:
// finds the header row, locates Style #, MOQ and Price by keyword, and folds
// every other descriptive column (Description, Size, Material, Color, …) into
// one combined description. Pure function over a Buffer — no disk access.
import * as XLSX from 'xlsx';
import { assertSafeXlsx } from './zipGuard.js';

export interface ParsedRow {
  /** 0-based order of this product within the sheet. */
  order: number;
  /** Absolute 0-based worksheet row (correlates with drawing-anchored images). */
  excelRow: number;
  styleNum: string;
  description: string;
  category: string;
  color: string;
  scentFragrance: string;
  packaging: string;
  moq: number | null;
  price: number | null;
  benchmarkLink: string;
}

export interface ParsedSheet {
  factoryName: string | null;
  rows: ParsedRow[];
}

function col(headers: unknown[], keywords: string[]): number {
  const lower = headers.map((h) => String(h ?? '').toLowerCase().trim());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Columns that are NOT descriptive spec text: style #, photos, pricing/MOQ and
// internal admin fields. Everything else is folded into the description.
const NON_SPEC = /style|photo|picture|image|\bmoq\b|price|fob|target|factory|email|\bunit|benchmark|link|per\s*40|volume|dimension/i;
const ERROR_CELL = /^#(VALUE|REF|N\/A|NAME|DIV|NULL)/i;

export function parseQuoteExcel(buf: Buffer): ParsedSheet {
  assertSafeXlsx(buf);
  const wb = XLSX.read(buf, { type: 'buffer', cellHTML: false, cellFormula: false });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) return { factoryName: null, rows: [] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (!grid.length) return { factoryName: null, rows: [] };

  const originRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;

  // Factory name from A1, e.g. "Factory Name: Acme".
  let factoryName: string | null = String(grid[0]?.[0] ?? '').replace(/factory\s*name\s*:?\s*/i, '').trim();
  if (!factoryName || factoryName.toUpperCase() === 'FACTORY PRICE CHART') factoryName = null;

  // Header row: first of the top 6 rows mentioning "style" or "price".
  let headerRowIdx = 1;
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const joined = (grid[i] ?? []).join('|').toLowerCase();
    if (joined.includes('style') || (joined.includes('price') && !joined.includes('chart'))) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = grid[headerRowIdx] ?? [];
  const C = {
    style: col(headers, ['style #', 'style#', 'style']),
    category: col(headers, ['category', 'categ']),
    color: col(headers, ['color']),
    scent: col(headers, ['scent', 'fragrance']),
    packaging: col(headers, ['packaging', 'pack']),
    moq: col(headers, ['moq', 'cut order', 'minimum order']),
    price: col(headers, ['price 1', 'price']),
    benchmark: col(headers, ['benchmark', 'link']),
  };
  const exclude = new Set([C.style, C.moq, C.price, C.benchmark].filter((i) => i >= 0));
  headers.forEach((h, ci) => {
    const s = String(h ?? '');
    if (!s.trim() || NON_SPEC.test(s)) exclude.add(ci);
  });

  const cell = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const rows: ParsedRow[] = [];
  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    // Skip blank rows and lone-label section dividers ("ADULTS", "— Bottles —").
    if (row.filter((c) => String(c).trim() !== '').length <= 1) continue;
    const styleNum = cell(row, C.style);
    const parts: string[] = [];
    row.forEach((v, ci) => {
      if (exclude.has(ci)) return;
      const s = String(v ?? '').trim();
      if (s && !ERROR_CELL.test(s)) parts.push(s);
    });
    const description = parts.join(', ');
    if (!styleNum && !/[a-z0-9]{2}/i.test(description)) continue;

    const price = Number.parseFloat(cell(row, C.price).replace(/[$,]/g, ''));
    // MOQ may read "60,000" or "10,000 per color": drop commas, take the leading number.
    const moqMatch = cell(row, C.moq).replace(/,/g, '').match(/\d+/);
    rows.push({
      order: rows.length,
      excelRow: originRow + i,
      styleNum,
      description,
      category: cell(row, C.category),
      color: cell(row, C.color),
      scentFragrance: cell(row, C.scent),
      packaging: cell(row, C.packaging),
      moq: moqMatch ? Number.parseInt(moqMatch[0], 10) : null,
      price: Number.isFinite(price) ? price : null,
      benchmarkLink: cell(row, C.benchmark),
    });
  }
  return { factoryName, rows };
}
