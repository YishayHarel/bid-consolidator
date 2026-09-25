import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fileUrl, verifyFileToken } from '../../src/lib/fileUrls.js';
import { signSession, verifySession } from '../../src/lib/auth.js';
import { emailList, nullableInt, nullableNumber, nullableText } from '../../src/lib/validate.js';

const token = (url: string) => url.replace('/files/', '');

describe('signed file URLs', () => {
  it('round-trips the storage key', () => {
    const url = fileUrl('orgs/1/projects/2/cads/abc.pdf', { downloadName: 'cad.pdf' })!;
    expect(verifyFileToken(token(url))).toEqual({ key: 'orgs/1/projects/2/cads/abc.pdf', downloadName: 'cad.pdf' });
  });
  it('rejects a tampered payload (cannot point a URL at another file)', () => {
    const url = fileUrl('orgs/1/projects/2/cads/abc.pdf')!;
    const [payload, sig] = token(url).split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'orgs/9/projects/9/cads/secret.pdf', e: 9e9 })).toString('base64url');
    expect(verifyFileToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyFileToken(`${payload}.${sig}x`)).toBeNull();
    expect(verifyFileToken('garbage')).toBeNull();
  });
  it('expires', () => {
    const url = fileUrl('k', { ttlSeconds: 1 })!;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 3600 * 1000);
    expect(verifyFileToken(token(url))).toBeNull();
    vi.useRealTimers();
  });
  it('is stable within the hour so browsers can cache images', () => {
    expect(fileUrl('same-key')).toBe(fileUrl('same-key'));
  });
  it('returns null for missing keys', () => {
    expect(fileUrl(null)).toBeNull();
  });
});

describe('session tokens', () => {
  it('round-trips claims', () => {
    const u = { id: 7, orgId: 3, role: 'admin' as const, email: 'a@b.com', name: 'A' };
    expect(verifySession(signSession(u))).toEqual(u);
  });
  it('rejects garbage and wrong-secret tokens', () => {
    expect(() => verifySession('nope')).toThrow(/session/);
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwib3JnIjoxLCJyb2xlIjoiYWRtaW4ifQ.bad-signature';
    expect(() => verifySession(forged)).toThrow(/session/);
  });
});

describe('validation helpers', () => {
  it('nullableNumber keeps a real 0, maps blank to null, strips $ and commas', () => {
    const s = z.object({ v: nullableNumber });
    expect(s.parse({ v: 0 }).v).toBe(0);
    expect(s.parse({ v: '0' }).v).toBe(0);
    expect(s.parse({ v: '' }).v).toBeNull();
    expect(s.parse({ v: null }).v).toBeNull();
    expect(s.parse({ v: '$1,234.50' }).v).toBe(1234.5);
    expect(s.safeParse({ v: 'abc' }).success).toBe(false);
  });
  it('nullableInt rejects fractions and negatives', () => {
    const s = z.object({ v: nullableInt });
    expect(s.parse({ v: '500' }).v).toBe(500);
    expect(s.safeParse({ v: 1.5 }).success).toBe(false);
    expect(s.safeParse({ v: -1 }).success).toBe(false);
  });
  it('emailList splits, trims, lowercases, de-dupes, validates', () => {
    expect(emailList.parse('A@x.com; b@x.com,\n a@X.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(emailList.safeParse('not-an-email').success).toBe(false);
  });
  it('nullableText trims and maps empty to null', () => {
    const s = z.object({ v: nullableText(5) });
    expect(s.parse({ v: '  hi ' }).v).toBe('hi');
    expect(s.parse({ v: '   ' }).v).toBeNull();
    expect(s.safeParse({ v: 'toolong' }).success).toBe(false);
  });
});
