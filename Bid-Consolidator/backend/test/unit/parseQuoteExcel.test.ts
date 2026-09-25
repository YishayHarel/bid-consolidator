import { describe, expect, it } from 'vitest';
import { parseQuoteExcel } from '../../src/domain/excel/parseQuoteExcel.js';
import { xlsx } from '../helpers.js';

describe('parseQuoteExcel', () => {
  it('finds the header row, folds spec columns into the description, parses MOQ and price', () => {
    const { factoryName, rows } = parseQuoteExcel(xlsx([
      ['Factory Name: Acme Drinkware'],
      ['Style #', 'Photo', 'Description', 'Material', 'Size', 'MOQ', 'Price 1', 'Factory Email'],
      ['H14085WB', '', 'ACTIVE TRIPLE INSULATED', 'SS304', '32OZ', '60,000', '$3.25', 'x@acme.com'],
      ['H14097WB', '', 'CHILL FLOW', 'SS201', '25OZ', '10,000 per color', '2.9', ''],
    ]));
    expect(factoryName).toBe('Acme Drinkware');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      order: 0, styleNum: 'H14085WB', description: 'ACTIVE TRIPLE INSULATED, SS304, 32OZ', moq: 60000, price: 3.25,
    });
    // "10,000 per color" → leading number; "$" / factory email excluded from specs
    expect(rows[1]).toMatchObject({ styleNum: 'H14097WB', moq: 10000, price: 2.9, description: 'CHILL FLOW, SS201, 25OZ' });
  });

  it('numbers products from 0 in sheet order (no off-by-one)', () => {
    const { rows } = parseQuoteExcel(xlsx([['Style #', 'Description', 'Price'], ['A', 'first item', 1], ['B', 'second item', 2]]));
    expect(rows.map((r) => r.order)).toEqual([0, 1]);
  });

  it('skips blank rows and lone-label section dividers', () => {
    const { rows } = parseQuoteExcel(xlsx([
      ['Style #', 'Description', 'Price'],
      ['— Bottles —', '', ''],
      ['', '', ''],
      ['B1', 'bottle', 4],
    ]));
    expect(rows.map((r) => r.styleNum)).toEqual(['B1']);
  });

  it('keeps rows without a style # when they have a real description', () => {
    const { rows } = parseQuoteExcel(xlsx([['Style #', 'Description', 'Size'], ['', 'DOUBLE WALL, SS304', '20OZ']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.styleNum).toBe('');
    expect(rows[0]!.description).toContain('DOUBLE WALL');
  });

  it('treats missing price/MOQ as null, never 0', () => {
    const { rows } = parseQuoteExcel(xlsx([['Style #', 'Description', 'MOQ', 'Price'], ['X', 'thing', '', 'TBD']]));
    expect(rows[0]).toMatchObject({ moq: null, price: null });
  });

  it('returns no rows for an empty sheet', () => {
    expect(parseQuoteExcel(xlsx([[]])).rows).toEqual([]);
  });
});
