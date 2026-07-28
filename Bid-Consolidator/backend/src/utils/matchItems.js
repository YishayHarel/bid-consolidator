// Aligns a factory's quote row to the correct outbound product.
//
// 1. Style # exact match (trimmed, case-insensitive).
// 2. Otherwise the outbound product whose combined description is most similar,
//    if the similarity clears a threshold.
// Returns the matched product's item_index, or null when nothing is confident.

const SIMILARITY_THRESHOLD = 0.45;

function normStyle(s) {
  return String(s || '').trim().toUpperCase();
}

// The product name is the first comma-segment of the combined description
// (the "Description" column), which factories and the outbound share verbatim
// even when the rest of the specs are worded differently.
function productName(desc) {
  return String(desc || '').split(',')[0].trim().toLowerCase();
}

// word set from a combined description, lowercased, punctuation stripped
function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
  );
}

// Dice coefficient over word sets: 2·|A∩B| / (|A|+|B|)
function similarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// items: [{ item_index, style_num, description }]
function resolveItemIndex(quote, items) {
  if (!items || !items.length) return null;

  // 1. Style # exact match
  const qStyle = normStyle(quote.style_num);
  if (qStyle) {
    const hit = items.find(it => normStyle(it.style_num) === qStyle);
    if (hit) return hit.item_index;
  }

  // 2. Exact product-name match (first segment of the description)
  const qName = productName(quote.description);
  if (qName && qName.length > 1) {
    const hit = items.find(it => productName(it.description) === qName);
    if (hit) return hit.item_index;
  }

  // 3. Best full-description similarity above threshold (loose fallback)
  let best = null;
  let bestScore = 0;
  for (const it of items) {
    const score = similarity(quote.description, it.description);
    if (score > bestScore) { bestScore = score; best = it; }
  }
  if (best && bestScore >= SIMILARITY_THRESHOLD) return best.item_index;

  return null;
}

module.exports = { resolveItemIndex, similarity, SIMILARITY_THRESHOLD };
