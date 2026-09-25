// Landed cost and margin math — the single source of truth (previously it lived
// only in the browser with hardcoded constants, and results were never stored
// anywhere the server could use). Constants are configurable per organization
// and overridable per project; the defaults match Shalom's current sheet.
export interface LandedCostSettings {
  /** True FOB = Total FOB ÷ this (commission is baked into Total FOB). */
  commissionDivisor: number;
  /** Ocean freight per 40' container, spread across units per container. */
  freightPerContainer: number;
  /** Default misc per-unit cost ("Etc.") when a quote has none. */
  defaultEtc: number;
}

export const DEFAULT_LANDED_COST_SETTINGS: LandedCostSettings = {
  commissionDivisor: 1.12,
  freightPerContainer: 7500,
  defaultEtc: 0.1,
};

export function effectiveSettings(org: unknown, project: unknown): LandedCostSettings {
  const pick = (src: unknown): Partial<LandedCostSettings> => {
    const lc = (src as { landedCost?: Partial<LandedCostSettings> } | null)?.landedCost;
    const out: Partial<LandedCostSettings> = {};
    if (lc && typeof lc.commissionDivisor === 'number' && lc.commissionDivisor > 0) out.commissionDivisor = lc.commissionDivisor;
    if (lc && typeof lc.freightPerContainer === 'number' && lc.freightPerContainer >= 0) out.freightPerContainer = lc.freightPerContainer;
    if (lc && typeof lc.defaultEtc === 'number' && lc.defaultEtc >= 0) out.defaultEtc = lc.defaultEtc;
    return out;
  };
  return { ...DEFAULT_LANDED_COST_SETTINGS, ...pick(org), ...pick(project) };
}

export interface LandedCostInputs {
  /** The factory's quoted FOB per unit. */
  fobPrice: number | null;
  totalFob: number | null;
  baseDutyPct: number | null; // whole-number percent, 7.2 = 7.2%
  addlDutyPct: number | null;
  unitsPerContainer: number | null;
  etcAmount: number | null;
  sellPrice: number | null;
  retailPrice: number | null;
}

export interface LandedCostResult {
  totalFob: number | null;
  vsrFob: number | null;
  commission: number | null;
  dutyPerUnit: number | null;
  totalDutyPct: number;
  freightPerUnit: number | null;
  freightPct: number | null;
  etc: number;
  landed: number | null;
  marginPct: number | null;
  imuPct: number | null;
}

const round = (n: number | null, dp = 4) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

export function computeLandedCost(i: LandedCostInputs, s: LandedCostSettings): LandedCostResult {
  const totalFob = i.totalFob ?? i.fobPrice ?? null; // default Total FOB to the quoted price
  // Duty and freight % are based on Total FOB (falling back to the quoted
  // price) — matching the established cost sheet exactly.
  const fob = totalFob ?? 0;
  const dutyPct = (i.baseDutyPct ?? 0) + (i.addlDutyPct ?? 0);
  const etc = i.etcAmount ?? s.defaultEtc;

  const vsrFob = totalFob !== null && totalFob > 0 ? totalFob / s.commissionDivisor : null;
  const commission = totalFob !== null && vsrFob !== null ? totalFob - vsrFob : null;
  const dutyPerUnit = fob > 0 ? fob * (dutyPct / 100) : null;
  const units = i.unitsPerContainer ?? 0;
  const freightPerUnit = units > 0 ? s.freightPerContainer / units : null;
  const freightPct = freightPerUnit !== null && fob > 0 ? freightPerUnit / fob : null;
  const landed = totalFob !== null && totalFob > 0 ? totalFob + (dutyPerUnit ?? 0) + (freightPerUnit ?? 0) + etc : null;

  const sell = i.sellPrice ?? 0;
  const retail = i.retailPrice ?? 0;
  const marginPct = landed !== null && sell > 0 ? ((sell - landed) / sell) * 100 : null;
  const imuPct = retail > 0 && sell > 0 ? ((retail - sell) / retail) * 100 : null;

  return {
    totalFob: round(totalFob),
    vsrFob: round(vsrFob),
    commission: round(commission),
    dutyPerUnit: round(dutyPerUnit),
    totalDutyPct: round(dutyPct, 4) ?? 0,
    freightPerUnit: round(freightPerUnit),
    freightPct: round(freightPct === null ? null : freightPct * 100, 2),
    etc: round(etc) ?? 0,
    landed: round(landed),
    marginPct: round(marginPct, 2),
    imuPct: round(imuPct, 2),
  };
}
