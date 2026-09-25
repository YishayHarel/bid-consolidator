import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';
import { field, int, money, pct, toNum } from './format';

describe('format helpers', () => {
  it('money/pct render dashes for missing values, never NaN', () => {
    expect(money(3.2)).toBe('$3.20');
    expect(money(null)).toBe('—');
    expect(money(Number.NaN)).toBe('—');
    expect(pct(22.43)).toBe('22.4%');
    expect(int(60000)).toBe((60000).toLocaleString());
  });
  it('toNum keeps a real 0, maps blank to null, strips $ and commas, rejects garbage', () => {
    expect(toNum('0')).toBe(0);
    expect(toNum('  ')).toBeNull();
    expect(toNum('$1,234.50')).toBe(1234.5);
    expect(toNum('abc')).toBeNull();
  });
  it('field maps null to an empty input value', () => {
    expect(field(null)).toBe('');
    expect(field(0)).toBe('0');
  });
});

describe('copyText (Safari-safe clipboard)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts the write immediately with a Promise-backed ClipboardItem', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class FakeItem { constructor(public data: Record<string, Promise<Blob>>) {} }
    vi.stubGlobal('ClipboardItem', FakeItem);
    vi.stubGlobal('Blob', NodeBlob); // jsdom's Blob lacks .text()
    vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } });
    let resolve!: (s: string) => void;
    const text = new Promise<string>((r) => { resolve = r; });
    const done = copyText(text);
    // The write was issued synchronously, before the text is even ready.
    expect(write).toHaveBeenCalledTimes(1);
    resolve('hello');
    await done;
    const blob = await (write.mock.calls[0]![0][0] as FakeItem).data['text/plain'];
    expect(await blob!.text()).toBe('hello');
  });

  it('times out instead of hanging when the clipboard never answers', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise(() => {}) } });
    await expect(copyText('x', 30)).rejects.toThrow(/did not respond/);
  });
});
