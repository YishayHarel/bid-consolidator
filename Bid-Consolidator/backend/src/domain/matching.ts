// Align a factory's quote row to the right product on the sheet.
//   1. Style # exact match (trimmed, case-insensitive)
//   2. Exact product-name match (first comma-segment of the description)
//   3. Best description similarity (Dice over word sets) above a threshold
// Returns the matched item's id, or null when nothing is confident — unmatched
// rows are kept and surfaced for manual assignment, never silently misfiled.
export const SIMILARITY_THRESHOLD = 0.45;

export interface MatchableItem { id: number; styleNum: string | null; description: string | null }

const normStyle = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();
const productName = (d: string | null | undefined) => String(d ?? '').split(',')[0]!.trim().toLowerCase();

function tokenSet(text: string | null | undefined): Set<string> {
  return new Set(
    String(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1),
  );
}

export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function matchItem(row: { styleNum?: string | null; description?: string | null }, items: MatchableItem[]): number | null {
  if (!items.length) return null;
  const s = normStyle(row.styleNum);
  if (s) {
    const hit = items.find((it) => normStyle(it.styleNum) === s);
    if (hit) return hit.id;
  }
  const name = productName(row.description);
  if (name.length > 1) {
    const hit = items.find((it) => productName(it.description) === name);
    if (hit) return hit.id;
  }
  let best: MatchableItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    const score = similarity(row.description, it.description);
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return best && bestScore >= SIMILARITY_THRESHOLD ? best.id : null;
}
