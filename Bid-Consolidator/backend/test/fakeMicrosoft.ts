// A stand-in for Microsoft's login and Graph APIs, used by the Outlook tests
// and by `npm run fake-microsoft` for trying Outlook sending locally.
//  - Tokens encode the mailbox: "at:<email>:<n>" / "rt:<email>:<n>".
//  - A code "good:<email>" signs in as <email>; the sign-in page instantly
//    "signs in" as the login_hint and redirects back.
//  - sendMail records messages instead of sending them.
import http from 'node:http';

export interface SentMail { from: string; to: string[]; subject: string; text: string; saveToSentItems: boolean }

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const json = (res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

export function createFakeMicrosoft(onSend?: (m: SentMail) => void) {
  const fake = { sent: [] as SentMail[], revoked: new Set<string>(), throttleNext: 0, refreshes: 0 };
  let n = 0;
  const tokensFor = (email: string) => ({ access_token: `at:${email}:${++n}`, refresh_token: `rt:${email}:${n}`, expires_in: 3600, token_type: 'Bearer' });
  const base = '/login/test-tenant/oauth2/v2.0';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const body = await readBody(req);

    if (req.method === 'GET' && url.pathname === `${base}/authorize`) {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', `good:${url.searchParams.get('login_hint') ?? 'someone@example.com'}`);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === `${base}/token`) {
      const f = new URLSearchParams(body);
      if (f.get('client_secret') !== 'test-secret') return json(res, 401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        const code = f.get('code') ?? '';
        if (!code.startsWith('good:') || !f.get('redirect_uri')?.endsWith('/api/mail/microsoft/callback')) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, tokensFor(code.slice(5)));
      }
      if (f.get('grant_type') === 'refresh_token') {
        fake.refreshes++;
        const email = (f.get('refresh_token') ?? '').split(':')[1] ?? '';
        if (fake.revoked.has(email)) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, tokensFor(email));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    const email = (req.headers.authorization ?? '').replace(/^Bearer at:/, '').split(':')[0] ?? '';
    if (!email) return json(res, 401, { error: { code: 'InvalidAuthenticationToken' } });
    if (req.method === 'GET' && url.pathname === '/graph/me') return json(res, 200, { mail: email, userPrincipalName: email });
    if (req.method === 'POST' && url.pathname === '/graph/me/sendMail') {
      if (fake.throttleNext > 0) { fake.throttleNext--; return json(res, 429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '0' }); }
      const m = JSON.parse(body) as {
        message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] };
        saveToSentItems: boolean;
      };
      const sent: SentMail = {
        from: email, to: m.message.toRecipients.map((r) => r.emailAddress.address),
        subject: m.message.subject, text: m.message.body.content, saveToSentItems: m.saveToSentItems,
      };
      fake.sent.push(sent);
      onSend?.(sent);
      return json(res, 202);
    }
    return json(res, 404, { error: { code: 'NotFound' } });
  });

  return { server, fake };
}
