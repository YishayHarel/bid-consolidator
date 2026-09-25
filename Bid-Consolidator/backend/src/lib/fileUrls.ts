// Signed, expiring file URLs. The API never exposes guessable file endpoints
// (the old /item-image/:id and /cad/:id could be walked by a script). Instead,
// authorized responses include URLs like `/files/<payload>.<sig>`, where the
// payload names the storage key and an expiry and the HMAC proves the server
// issued it. The file route needs no session: possession of an unexpired signed
// URL is the authorization, so <img src> works for logged-in users and for
// factories on the portal alike.
//
// Expiry is rounded up to the hour so the same file gets the same URL for up to
// an hour — browsers can cache images instead of re-downloading on every render.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const secret = config.FILE_URL_SECRET ?? createHmac('sha256', config.JWT_SECRET).update('file-url-signing-v1').digest('hex');
const BUCKET_SECONDS = 3600;
const DEFAULT_TTL_SECONDS = 6 * 3600;

const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Build a signed URL path (relative to the API root) for a storage key. */
export function fileUrl(key: string | null | undefined, opts: { ttlSeconds?: number; downloadName?: string } = {}): string | null {
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.ceil((now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS)) / BUCKET_SECONDS) * BUCKET_SECONDS;
  const body: { k: string; e: number; d?: string } = { k: key, e: exp };
  if (opts.downloadName) body.d = opts.downloadName;
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `/files/${payload}.${sign(payload)}`;
}

/** Verify a signed token from the URL; returns the key, or null if invalid/expired. */
export function verifyFileToken(token: string): { key: string; downloadName?: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k?: unknown; e?: unknown; d?: unknown };
    if (typeof body.k !== 'string' || typeof body.e !== 'number') return null;
    if (body.e < Math.floor(Date.now() / 1000)) return null;
    return { key: body.k, ...(typeof body.d === 'string' ? { downloadName: body.d } : {}) };
  } catch {
    return null;
  }
}
