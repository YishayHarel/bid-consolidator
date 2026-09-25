// Division-specific sheet formats, decided in ONE place (the GM-only Inner/Master
// rule used to be duplicated across two frontend files). Add a division's extra
// columns here and both the Compare sheet and the factory portal follow.
export interface DivisionFormat {
  /** Inner # / Master # pack counts (keyed in by the project creator). */
  packCounts: boolean;
}

export function divisionFormat(division: string | null | undefined): DivisionFormat {
  const d = String(division ?? '').trim();
  return { packCounts: /^(gm|general)/i.test(d) };
}

export const KNOWN_DIVISIONS = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen', 'General'];
