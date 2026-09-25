import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { formatOverpricedLines, overpricedByFactory } from '../../src/domain/bestAndFinal.js';
import { divisionFormat } from '../../src/domain/divisions.js';
import { assertSafeXlsx } from '../../src/domain/excel/zipGuard.js';
import { computeLandedCost, DEFAULT_LANDED_COST_SETTINGS, effectiveSettings } from '../../src/domain/landedCost.js';
import { matchItem, similarity } from '../../src/domain/matching.js';

describe('matchItem', () => {
  const items = [
    { id: 1, styleNum: 'H14085WB', description: 'ACTIVE TRIPLE INSULATED, 32OZ, copper' },
    { id: 2, styleNum: 'H14097WB', description: 'CHILL FLOW, 25OZ, double wall' },
    { id: 3, styleNum: null, description: 'SILICONE SPOUT BOTTLE, 30 OZ, double wall stainless' },
  ];
  it('matches on style # first, case/space-insensitive', () => {
    expect(matchItem({ styleNum: ' h14097wb ', description: 'anything' }, items)).toBe(2);
  });
  it('falls back to exact product name (first description segment)', () => {
    expect(matchItem({ styleNum: '', description: 'Chill Flow, different specs wording' }, items)).toBe(2);
  });
  it('falls back to description similarity above the threshold', () => {
    expect(matchItem({ styleNum: '', description: 'silicone spout bottle 30 oz stainless double wall' }, items)).toBe(3);
  });
  it('returns null instead of guessing when nothing is confident', () => {
    expect(matchItem({ styleNum: 'ZZ9', description: 'dog leash nylon' }, items)).toBeNull();
    expect(matchItem({ styleNum: 'A' }, [])).toBeNull();
  });
  it('similarity is a symmetric Dice coefficient in [0,1]', () => {
    expect(similarity('red bottle cap', 'red bottle cap')).toBe(1);
    expect(similarity('red bottle', 'bottle red')).toBe(1);
    expect(similarity('red bottle', 'blue bottle')).toBeCloseTo(0.5, 5);
    expect(similarity('', 'x')).toBe(0);
    // single-character tokens are ignored as noise
    expect(similarity('a b c', 'a b c')).toBe(0);
  });
});

describe('computeLandedCost (server-side single source of truth)', () => {
  const s = DEFAULT_LANDED_COST_SETTINGS;
  const blank = { totalFob: null, baseDutyPct: null, addlDutyPct: null, unitsPerContainer: null, etcAmount: null, sellPrice: null, retailPrice: null };

  it('reproduces the original cost-sheet formula', () => {
    // Original: true_fob = total/1.12; commission = total - true_fob; duty = total*(dutyPct);
    // freight = 7500/units; landed = true_fob + commission + duty + freight + etc
    const r = computeLandedCost({ ...blank, fobPrice: 3, totalFob: 3.36, baseDutyPct: 7.2, addlDutyPct: 25, unitsPerContainer: 15000, etcAmount: 0.1, sellPrice: 6.5, retailPrice: 12.99 }, s);
    const duty = 3.36 * 0.322;
    const freight = 7500 / 15000;
    const landed = 3.36 + duty + freight + 0.1;
    expect(r.vsrFob).toBeCloseTo(3.36 / 1.12, 4);
    expect(r.commission).toBeCloseTo(3.36 - 3.36 / 1.12, 4);
    expect(r.dutyPerUnit).toBeCloseTo(duty, 4);
    expect(r.freightPerUnit).toBeCloseTo(0.5, 4);
    expect(r.landed).toBeCloseTo(landed, 4);
    expect(r.marginPct).toBeCloseTo(((6.5 - landed) / 6.5) * 100, 1);
    expect(r.imuPct).toBeCloseTo(((12.99 - 6.5) / 12.99) * 100, 1);
  });
  it('defaults Total FOB to the quoted price', () => {
    expect(computeLandedCost({ ...blank, fobPrice: 2 }, s).totalFob).toBe(2);
  });
  it('keeps a real 0 for Etc. (the old code forced it back to 0.10)', () => {
    expect(computeLandedCost({ ...blank, fobPrice: 2, etcAmount: 0 }, s).etc).toBe(0);
    expect(computeLandedCost({ ...blank, fobPrice: 2, etcAmount: null }, s).etc).toBe(0.1);
  });
  it('returns null landed cost when there is no price at all (no garbage numbers)', () => {
    expect(computeLandedCost({ ...blank, fobPrice: null }, s).landed).toBeNull();
  });
  it('uses org then project overrides for the constants', () => {
    const eff = effectiveSettings({ landedCost: { freightPerContainer: 9000 } }, { landedCost: { commissionDivisor: 1.1 } });
    expect(eff).toEqual({ commissionDivisor: 1.1, freightPerContainer: 9000, defaultEtc: 0.1 });
    expect(effectiveSettings({ landedCost: { commissionDivisor: -5 } }, null).commissionDivisor).toBe(1.12);
  });
});

describe('overpricedByFactory (Best & Final)', () => {
  it('flags factories above the lowest price only where 2+ factories competed', () => {
    const out = overpricedByFactory([
      { itemId: 1, itemLabel: 'H1', projectFactoryId: 10, price: 2.0 },
      { itemId: 1, itemLabel: 'H1', projectFactoryId: 11, price: 2.5 },
      { itemId: 1, itemLabel: 'H1', projectFactoryId: 12, price: 2.0 }, // tie with lowest: competitive
      { itemId: 2, itemLabel: 'H2', projectFactoryId: 11, price: 9.0 }, // alone on item 2: no competition
    ]);
    expect([...out.keys()]).toEqual([11]);
    expect(out.get(11)![0]).toMatchObject({ label: 'H1', bestPrice: 2, theirPrice: 2.5 });
    expect(out.get(11)![0]!.pctHigher).toBeCloseTo(25, 5);
    expect(formatOverpricedLines(out.get(11)!)).toContain('(25.0% higher)');
  });
});

describe('divisionFormat', () => {
  it('shows Inner/Master pack counts for GM only', () => {
    expect(divisionFormat('General').packCounts).toBe(true);
    expect(divisionFormat(' GM ').packCounts).toBe(true);
    expect(divisionFormat('Hydration').packCounts).toBe(false);
    expect(divisionFormat(null).packCounts).toBe(false);
  });
});

describe('assertSafeXlsx (zip-bomb guard)', () => {
  it('rejects archives with an abusive number of parts', () => {
    const zip = new AdmZip();
    for (let i = 0; i < 5001; i++) zip.addFile(`f${i}.txt`, Buffer.from('x'));
    expect(() => assertSafeXlsx(zip.toBuffer())).toThrow(/too many parts/);
  });
  it('rejects garbage that claims to be a zip', () => {
    expect(() => assertSafeXlsx(Buffer.from('PK not really a zip'))).toThrow(/valid Excel/);
  });
  it('lets legacy binary .xls (non-zip) through to the parser', () => {
    expect(() => assertSafeXlsx(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).not.toThrow();
  });
});
