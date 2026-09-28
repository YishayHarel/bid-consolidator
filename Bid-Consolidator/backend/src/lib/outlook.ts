// Sending as each buyer from their own Outlook mailbox (Microsoft 365).
//
// A buyer connects once (Settings → Outlook): the browser goes through
// Microsoft's sign-in, Microsoft redirects back to our callback with a code,
// and we exchange it for tokens (delegated Mail.Send — the app can only send
// AS that buyer, never read their mail). Emails then go out through Microsoft
// Graph, land in the buyer's own Sent Items, and replies come straight back
// to them.
//
// Safety:
//  - The mailbox must be the buyer's own: its address has to match their login
//    email. So nobody can trick a colleague into attaching the colleague's
//    mailbox to someone else's account (a forged/forwarded connect link fails).
//  - The OAuth `state` is HMAC-signed, names the user, and expires in 10 minutes.
//  - Tokens are encrypted (AES-256-GCM) before they're stored.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { pool, queryOne, withTx } from '../db/pool.js';
import { AppError, badRequest, unavailable } from './errors.js';
import { logger } from './logger.js';

const SCOPES = 'offline_access openid email User.Read Mail.Send';
export const redirectUri = () => `${config.apiUrl}/api/mail/microsoft/callback`;

// ---- Encryption at rest -------------------------------------------------------------------------
const key = config.MAIL_TOKEN_KEY
  ? createHash('sha256').update(config.MAIL_TOKEN_KEY).digest()
  : createHmac('sha256', config.JWT_SECRET).update('mail-token-encryption-v1').digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function decrypt(sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('unrecognized token encoding');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

// ---- Signed OAuth state -------------------------------------------------------------------------
const stateMac = (s: string) => createHmac('sha256', key).update(`oauth-state:${s}`).digest('base64url');
export function signState(userId: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + 10 * 60_000, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${stateMac(payload)}`;
}
export function verifyState(state: string, now = Date.now()): number | null {
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(stateMac(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: number; e: number };
    return Number.isInteger(u) && e > now ? u : null;
  } catch { return null; }
}

// ---- Microsoft endpoints ------------------------------------------------------------------------
function requireEnabled() {
  if (!config.outlookEnabled) throw unavailable('Outlook sending is not set up on the server yet (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET).');
}
const loginBase = () => `${config.MS_LOGIN_URL.replace(/\/+$/, '')}/${encodeURIComponent(config.MS_TENANT_ID!)}/oauth2/v2.0`;

export function authorizeUrl(userId: number, loginHint?: string): string {
  requireEnabled();
  const q = new URLSearchParams({
    client_id: config.MS_CLIENT_ID!, response_type: 'code', response_mode: 'query',
    redirect_uri: redirectUri(), scope: SCOPES, state: signState(userId), prompt: 'select_account',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${loginBase()}/authorize?${q}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${loginBase()}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.MS_CLIENT_ID!, client_secret: config.MS_CLIENT_SECRET!, scope: SCOPES, ...params }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    // invalid_grant = the buyer revoked access, changed password, or the grant aged out.
    if (data.error === 'invalid_grant') throw new AppError(409, 'Your Outlook connection has expired. Reconnect it in Settings.', 'mail_reconnect');
    logger.warn({ status: res.status, error: data.error }, 'microsoft token request failed');
    throw new AppError(502, 'Microsoft sign-in failed. Please try again.', 'mail_provider');
  }
  return data as TokenResponse;
}

async function graph(path: string, accessToken: string, init: RequestInit = {}) {
  return fetch(`${config.MS_GRAPH_URL.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

// ---- Connect / status / disconnect --------------------------------------------------------------
/** OAuth callback: exchange the code, confirm the mailbox is the user's own, store encrypted tokens. */
export async function completeConnect(code: string, state: string): Promise<{ address: string }> {
  requireEnabled();
  const userId = verifyState(state);
  if (!userId) throw badRequest('This Outlook sign-in link expired or is invalid. Start again from Settings.');
  const user = await queryOne<{ email: string }>(pool, 'SELECT email FROM users WHERE id = $1', [userId]);
  if (!user) throw badRequest('Account not found.');

  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new AppError(502, 'Microsoft did not grant offline access. Please try again.', 'mail_provider');
  const me = await graph('/me?$select=mail,userPrincipalName', tokens.access_token);
  const profile = (await me.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
  const addresses = [profile.mail, profile.userPrincipalName].filter((a): a is string => !!a).map((a) => a.toLowerCase());
  if (!addresses.includes(user.email.toLowerCase())) {
    throw new AppError(403, `That Microsoft account (${addresses[0] ?? 'unknown'}) isn't ${user.email}. Sign in with your own mailbox.`, 'mail_mismatch');
  }
  const address = profile.mail ?? profile.userPrincipalName!;
  await pool.query(
    `INSERT INTO mail_accounts (user_id, provider, address, refresh_token_enc, access_token_enc, access_expires_at)
     VALUES ($1, 'microsoft', $2, $3, $4, now() + make_interval(secs => $5))
     ON CONFLICT (user_id) DO UPDATE SET address = EXCLUDED.address, refresh_token_enc = EXCLUDED.refresh_token_enc,
       access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at,
       connected_at = now(), updated_at = now()`,
    [userId, address, encrypt(tokens.refresh_token), encrypt(tokens.access_token), tokens.expires_in - 60],
  );
  return { address };
}

export async function mailStatus(userId: number) {
  const row = await queryOne<{ address: string; connected_at: Date }>(pool, 'SELECT address, connected_at FROM mail_accounts WHERE user_id = $1', [userId]);
  return {
    available: config.outlookEnabled,
    connected: !!row,
    address: row?.address ?? null,
    connectedAt: row?.connected_at ?? null,
  };
}

export async function disconnect(userId: number) {
  await pool.query('DELETE FROM mail_accounts WHERE user_id = $1', [userId]);
}

export async function hasMailbox(userId: number): Promise<boolean> {
  return config.outlookEnabled && !!(await queryOne(pool, 'SELECT 1 FROM mail_accounts WHERE user_id = $1', [userId]));
}

/**
 * A valid access token for the user, refreshing it when it's about to expire.
 * The row lock serializes refreshes, so concurrent sends never race to rotate
 * the refresh token.
 */
async function accessToken(userId: number, forceRefresh = false): Promise<string> {
  requireEnabled();
  try {
    return await withTx(async (tx) => {
      const row = await queryOne<{ refresh_token_enc: string; access_token_enc: string | null; fresh: boolean }>(tx,
        `SELECT refresh_token_enc, access_token_enc, (access_expires_at > now() + interval '2 minutes') AS fresh
           FROM mail_accounts WHERE user_id = $1 FOR UPDATE`, [userId]);
      if (!row) throw new AppError(409, 'Connect your Outlook in Settings to send email from the site.', 'mail_not_connected');
      if (row.access_token_enc && row.fresh && !forceRefresh) return decrypt(row.access_token_enc);
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token_enc) });
      await tx.query(
        `UPDATE mail_accounts SET access_token_enc = $2, access_expires_at = now() + make_interval(secs => $3),
           refresh_token_enc = COALESCE($4, refresh_token_enc), updated_at = now() WHERE user_id = $1`,
        [userId, encrypt(t.access_token), t.expires_in - 60, t.refresh_token ? encrypt(t.refresh_token) : null]);
      return t.access_token;
    });
  } catch (err) {
    // A dead grant can't recover: drop it so the UI shows "Connect Outlook" again.
    if (err instanceof AppError && err.code === 'mail_reconnect') await disconnect(userId);
    throw err;
  }
}

export interface GraphMail { to: string[]; subject: string; text: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send one email as the user. Retries throttling (429/503) and one expired token. */
export async function sendAsUser(userId: number, msg: GraphMail): Promise<void> {
  const payload = JSON.stringify({
    message: {
      subject: msg.subject,
      body: { contentType: 'Text', content: msg.text },
      toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  });
  let token = await accessToken(userId);
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    const res = await graph('/me/sendMail', token, { method: 'POST', body: payload });
    if (res.status === 202 || res.ok) return;
    if (res.status === 401 && !refreshed) { refreshed = true; token = await accessToken(userId, true); continue; }
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const ra = Number(res.headers.get('retry-after') ?? NaN);
      const wait = Math.min(60, Number.isFinite(ra) && ra >= 0 ? ra : 5 * attempt);
      await sleep(wait * 1000);
      continue;
    }
    const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    logger.warn({ status: res.status, code: err.error?.code }, 'graph sendMail failed');
    if (res.status === 403) throw new AppError(403, 'Outlook refused to send from your mailbox (permission). Reconnect Outlook in Settings or ask IT.', 'mail_forbidden');
    if (res.status === 400) throw badRequest(`Outlook rejected this email: ${err.error?.message ?? 'invalid message'}`);
    throw new AppError(502, 'Outlook could not send the email right now. Please try again.', 'mail_provider');
  }
}
