const XLSX = require('xlsx');

const DIVISION_KEYWORDS = {
  'Hydration': ['hydrat', 'water', 'bottle', 'tumbler', 'drinkware'],
  'Pet Beauty': ['pet', 'dog', 'cat', 'animal', 'grooming'],
  'Hard Coolers': ['hard cooler', 'hard-cooler', 'roto', 'rotomold'],
  'Soft Coolers': ['soft cooler', 'soft-cooler', 'lunch', 'tote cooler'],
  'Kitchen': ['kitchen', 'cook', 'utensil', 'cutting', 'knife'],
};

const PROJECT_KEYWORDS = {
  'Ross': ['ross'],
  'Burlington': ['burlington', 'burl'],
  'Body Glove': ['body glove', 'bodyglove'],
  'TJ Maxx': ['tjmaxx', 'tj maxx', 'marshalls'],
  'Target': ['target'],
  'Walmart': ['walmart', 'wal-mart'],
  'Amazon': ['amazon'],
};

function detectDivision(text) {
  const lower = text.toLowerCase();
  for (const [division, keywords] of Object.entries(DIVISION_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return division;
  }
  return 'General';
}

function detectProject(text) {
  const lower = text.toLowerCase();
  for (const [project, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return project;
  }
  return null;
}

function findCol(headers, keywords) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim());
  for (const kw of keywords) {
    const idx = lower.findIndex(h => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) return { factoryName: '', products: [], division: 'General', detectedProject: null };

  // Factory name from A1
  const factoryName = (rows[0][0] || '').toString().trim();

  // Find header row — scan first 6 rows for "style #" or "price 1"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const rowLower = rows[i].map(c => (c || '').toString().toLowerCase());
    if (rowLower.some(c => c.includes('style #') || c.includes('style#')) ||
        rowLower.some(c => c.includes('price 1') && !c.includes('price chart'))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) return { factoryName, products: [], division: 'General', detectedProject: null };

  const headers = rows[headerRowIdx];
  const styleCol = findCol(headers, ['style #', 'style#']);
  const factoryStyleCol = findCol(headers, ['factory style', 'factory styl']);
  const descCol = findCol(headers, ['description', 'desc']);
  const priceCol = findCol(headers, ['price 1']);
  const moqCol = findCol(headers, ['moq']);
  const packCol = findCol(headers, ['pack', 'packaging']);
  const containerCol = findCol(headers, ['units per', 'container', '40"']);
  const categoryCol = findCol(headers, ['category']);
  const colorCol = findCol(headers, ['color', 'scent']);

  const products = [];
  const allText = rows.map(r => r.join(' ')).join(' ');
  const division = detectDivision(allText);
  const detectedProject = detectProject(allText);

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const styleNum = styleCol !== -1 ? (row[styleCol] || '').toString().trim() : '';
    if (!styleNum) continue;

    const rawPrice = priceCol !== -1 ? row[priceCol] : '';
    const price = parseFloat(rawPrice) || null;

    products.push({
      factory_name: factoryName,
      style_num: styleNum,
      factory_style: factoryStyleCol !== -1 ? (row[factoryStyleCol] || '').toString().trim() : '',
      description: descCol !== -1 ? (row[descCol] || '').toString().trim() : '',
      packaging: packCol !== -1 ? (row[packCol] || '').toString().trim() : '',
      moq: moqCol !== -1 ? (parseInt(row[moqCol]) || null) : null,
      price,
      container_units: containerCol !== -1 ? (parseInt(row[containerCol]) || null) : null,
      category: categoryCol !== -1 ? (row[categoryCol] || '').toString().trim() : '',
      color: colorCol !== -1 ? (row[colorCol] || '').toString().trim() : '',
    });
  }

  return { factoryName, products, division, detectedProject };
}

module.exports = { parseExcel, detectDivision, detectProject };
