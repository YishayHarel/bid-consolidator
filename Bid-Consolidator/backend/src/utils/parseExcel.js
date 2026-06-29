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
    moq:       col(headers, ['moq']),
    price:     col(headers, ['price 1', 'price']),
    benchmark: col(headers, ['benchmark', 'link']),
  };

  const quotes = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some(c => String(c).trim() !== '')) continue;
    const styleNum = C.style >= 0 ? String(row[C.style] || '').trim() : '';
    if (!styleNum) continue;

    const price = parseFloat(row[C.price]);
    const moq   = parseInt(row[C.moq]);
    quotes.push({
      factory_name:    factoryName,
      style_num:       styleNum,
      description:     C.desc >= 0      ? String(row[C.desc] || '').trim()       : '',
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
