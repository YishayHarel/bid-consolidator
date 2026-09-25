// Best & Final analysis: for every item with real competition (2+ factories
// priced it), flag each factory priced strictly above the lowest, with how far
// above. The lowest (and ties) are already competitive. The internal target
// price is never revealed — factories only see the current best FOB.
export interface PricedQuote {
  itemId: number;
  itemLabel: string;
  projectFactoryId: number;
  price: number;
}
export interface OverpricedLine {
  itemId: number;
  label: string;
  bestPrice: number;
  theirPrice: number;
  pctHigher: number;
}

export function overpricedByFactory(quotes: PricedQuote[]): Map<number, OverpricedLine[]> {
  const byItem = new Map<number, PricedQuote[]>();
  for (const q of quotes) {
    if (!Number.isFinite(q.price) || q.price <= 0) continue;
    const list = byItem.get(q.itemId) ?? [];
    list.push(q);
    byItem.set(q.itemId, list);
  }
  const out = new Map<number, OverpricedLine[]>();
  for (const [itemId, qs] of byItem) {
    if (new Set(qs.map((q) => q.projectFactoryId)).size < 2) continue; // no competition
    const lowest = Math.min(...qs.map((q) => q.price));
    for (const q of qs) {
      if (q.price <= lowest) continue;
      const lines = out.get(q.projectFactoryId) ?? [];
      lines.push({ itemId, label: q.itemLabel, bestPrice: lowest, theirPrice: q.price, pctHigher: ((q.price - lowest) / lowest) * 100 });
      out.set(q.projectFactoryId, lines);
    }
  }
  return out;
}

export function formatOverpricedLines(lines: OverpricedLine[]): string {
  return lines
    .map((l) => `• ${l.label}\n    Our current best FOB: $${l.bestPrice.toFixed(2)}   |   Your quote: $${l.theirPrice.toFixed(2)}   (${l.pctHigher.toFixed(1)}% higher)`)
    .join('\n');
}
