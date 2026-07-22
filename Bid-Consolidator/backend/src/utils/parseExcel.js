const XLSX = require('xlsx');

function col(headers, keywords) {
  const lower = headers.map(h => String(h || '').toLowerCase().trim());
  for (const kw of keywords) {
    const idx = lower.findIndex(h => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseQuoteExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) return { factoryName: 'Unknown', quotes: [] };

  // Absolute 0-based row of rows[0], so items can correlate to drawing-XML
  // image anchors (which use absolute worksheet row indices).
  const originRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;

  // Factory name from A1 — strip the label if present
  let factoryName = String(rows[0]?.[0] || '').replace(/factory\s*name\s*:?\s*/i, '').trim();
  if (!factoryName || factoryName.toUpperCase() === 'FACTORY PRICE CHART') factoryName = 'Unknown Factory';

  // Find header row (contains "style" or "price")
  let headerRowIdx = 1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const joined = rows[i].join('|').toLowerCase();
    if (joined.includes('style') || (joined.includes('price') && !joined.includes('chart'))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx];
  const C = {
    style:     col(headers, ['style #', 'style#', 'style']),
    desc:      col(headers, ['description', 'desc']),
    category:  col(headers, ['category', 'categ']),
    color:     col(headers, ['color']),
    scent:     col(headers, ['scent', 'fragrance']),
    packaging: col(headers, ['packaging', 'pack']),
    moq:       col(headers, ['moq', 'cut order', 'minimum order']),
    price:     col(headers, ['price 1', 'price']),
    benchmark: col(headers, ['benchmark', 'link']),
  };

  // Columns that are NOT part of the descriptive spec text: style#, photos,
  // pricing/MOQ, and internal admin fields (factory name/email, units, links).
  // Everything else (Description, Size, Material, Color, cartons, …) is spec.
  const NON_SPEC = /style|photo|picture|image|\bmoq\b|price|fob|target|factory|email|\bunit|benchmark|link|per\s*40|volume|dimension/i;
  const excludeCols = new Set([C.style, C.moq, C.price, C.benchmark].filter(i => i >= 0));
  for (let ci = 0; ci < headers.length; ci++) {
    const h = String(headers[ci] || '');
    if (!h.trim() || NON_SPEC.test(h)) excludeCols.add(ci);
  }

  const quotes = [];
  let itemIndex = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const nonEmpty = row.filter(c => String(c).trim() !== '').length;
    // Skip blank rows and lone-label section dividers (e.g. a cell that just
    // says "ADULTS" or "— Bottles —"): a real product always fills several
    // columns (description, size, price, etc.).
    if (nonEmpty <= 1) continue;
    const styleNum = C.style >= 0 ? String(row[C.style] || '').trim() : '';

    // Combined description: every spec column joined with commas — everything
    // except Style #, Photo(s), MOQ and Price. Photo cells (empty or #VALUE!
    // in-cell-image placeholders) drop out. The exact spec columns vary by
    // project, so this is column-agnostic.
    const descParts = [];
    for (let ci = 0; ci < row.length; ci++) {
      if (excludeCols.has(ci)) continue;
      const v = String(row[ci] ?? '').trim();
      if (!v || /^#(VALUE|REF|N\/A|NAME|DIV|NULL)/i.test(v)) continue;
      descParts.push(v);
    }
    const description = descParts.join(', ');
    if (!styleNum && !/[a-z0-9]{2}/i.test(description)) continue;

    itemIndex += 1;
    const price = parseFloat(row[C.price]);
    // MOQ may be formatted like "60,000" or "10,000 per color" — drop commas,
    // then take the leading number.
    const moqMatch = String(row[C.moq] ?? '').replace(/,/g, '').match(/\d+/);
    const moq   = moqMatch ? parseInt(moqMatch[0], 10) : NaN;
    quotes.push({
      factory_name:    factoryName,
      item_index:      itemIndex,
      excel_row:       originRow + i,
      style_num:       styleNum,
      description,
      category:        C.category >= 0  ? String(row[C.category] || '').trim()   : '',
      color:           C.color >= 0     ? String(row[C.color] || '').trim()      : '',
      scent_fragrance: C.scent >= 0     ? String(row[C.scent] || '').trim()      : '',
      packaging:       C.packaging >= 0 ? String(row[C.packaging] || '').trim()  : '',
      moq:             isNaN(moq)       ? null                                    : moq,
      price:           isNaN(price)     ? null                                    : price,
      benchmark_link:  C.benchmark >= 0 ? String(row[C.benchmark] || '').trim()  : '',
    });
  }

  return { factoryName, quotes };
}

module.exports = { parseQuoteExcel };
