// Sending from each buyer's own Outlook, and batch sends — against a fake
// Microsoft (login + Graph) server that behaves like the real endpoints.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testOutbox } from '../../src/lib/mailer.js';
import { createFakeMicrosoft } from '../fakeMicrosoft.js';
import { anon, as, drainJobs, invite, makeOrg, makeProject, makeUser, pool } from '../helpers.js';

const { server, fake } = createFakeMicrosoft();

beforeAll(() => new Promise<void>((r) => server.listen(47811, '127.0.0.1', () => r())));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { fake.sent.length = 0; fake.revoked.clear(); fake.throttleNext = 0; fake.refreshes = 0; testOutbox.length = 0; });

async function buyer() {
  const org = await makeOrg();
  const u = await makeUser(org, { name: 'Jack' });
  const p = await makeProject(u.token, { name: 'Billabong' });
  const api = as(u.token);
  const item = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H1' })).body;
  const [alpha, beta] = await invite(u.token, p.id, ['Alpha', 'Beta']);
  return { u, p, api, item, alpha: alpha!, beta: beta! };
}

/** Run the browser's side of Microsoft sign-in: follow the connect URL's state into our callback. */
async function connect(token: string, mailbox: string) {
  const { url } = (await as(token).post('/api/mail/microsoft/connect')).body as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  return anon().get('/api/mail/microsoft/callback').query({ code: `good:${mailbox}`, state });
}

describe('connecting Outlook', () => {
  it('sends the buyer to Microsoft sign-in for delegated Mail.Send, and stores encrypted tokens', async () => {
    const { u } = await buyer();
    const { url } = (await as(u.token).post('/api/mail/microsoft/connect')).body;
    const q = new URL(url);
    expect(q.origin + q.pathname).toBe('http://127.0.0.1:47811/login/test-tenant/oauth2/v2.0/authorize');
    expect(q.searchParams.get('scope')).toContain('Mail.Send');
    expect(q.searchParams.get('scope')).not.toMatch(/Mail\.Read/); // can send as them, never read their mail
    expect(q.searchParams.get('redirect_uri')).toBe('http://api.test/api/mail/microsoft/callback');

    const cb = await connect(u.token, u.email);
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toBe('http://localhost:5173/app/settings?outlook=connected');
    expect((await as(u.token).get('/api/mail/status')).body).toMatchObject({ available: true, connected: true, address: u.email });
    const row = (await pool.query('SELECT refresh_token_enc, access_token_enc FROM mail_accounts WHERE user_id = $1', [u.user.id])).rows[0];
    expect(row.refresh_token_enc).not.toContain('rt:');
    expect(row.access_token_enc).not.toContain('at:');
  });

  it('refuses a mailbox that is not the buyer\'s own (no attaching a colleague\'s Outlook)', async () => {
    const { u } = await buyer();
    const cb = await connect(u.token, 'colleague@shalomint.com');
    expect(cb.headers.location).toMatch(/outlook=mismatch$/);
    expect((await as(u.token).get('/api/mail/status')).body.connected).toBe(false);
  });

  it('rejects a forged or tampered state', async () => {
    const { u } = await buyer();
    const { url } = (await as(u.token).post('/api/mail/microsoft/connect')).body;
    const state = new URL(url).searchParams.get('state')!;
    const tampered = `${Buffer.from(JSON.stringify({ u: 1, e: Date.now() + 60_000, n: 'x' })).toString('base64url')}.${state.split('.')[1]}`;
    const cb = await anon().get('/api/mail/microsoft/callback').query({ code: `good:${u.email}`, state: tampered });
    expect(cb.headers.location).toMatch(/outlook=expired$/);
    expect((await as(u.token).get('/api/mail/status')).body.connected).toBe(false);
  });

  it('can be disconnected', async () => {
    const { u } = await buyer();
    await connect(u.token, u.email);
    expect((await as(u.token).delete('/api/mail/microsoft')).status).toBe(204);
    expect((await as(u.token).get('/api/mail/status')).body.connected).toBe(false);
  });
});

describe('sending from Outlook', () => {
  it('a single Send goes out from the buyer\'s mailbox, saved to their Sent Items', async () => {
    const { u, p, api, alpha } = await buyer();
    await connect(u.token, u.email);
    const res = await api.post(`/api/projects/${p.id}/emails/send`)
      .send({ type: 'vendor_invite', projectFactoryId: alpha.id, subject: 'Quote', body: 'Link: [Portal Link]' });
    expect(res.body).toMatchObject({ sent: true, via: 'outlook', to: ['alpha@factory.test'] });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ from: u.email, to: ['alpha@factory.test'], subject: 'Quote', saveToSentItems: true });
    expect(fake.sent[0]!.text).toMatch(/\/vendor\?token=[0-9a-f-]{36}/);
    expect(testOutbox).toHaveLength(0);
  });

  it('refreshes an expired access token, and retries when Outlook throttles', async () => {
    const { u, p, api, alpha } = await buyer();
    await connect(u.token, u.email);
    await pool.query(`UPDATE mail_accounts SET access_expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.user.id]);
    fake.throttleNext = 1;
    const res = await api.post(`/api/projects/${p.id}/emails/send`).send({ type: 'vendor_invite', projectFactoryId: alpha.id, subject: 's', body: 'b' });
    expect(res.status).toBe(200);
    expect(fake.refreshes).toBe(1);
    expect(fake.sent).toHaveLength(1);
  });
});

describe('batch send', () => {
  it('sends every reviewed email in the background and reports the result', async () => {
    const { u, p, api, alpha, beta } = await buyer();
    await connect(u.token, u.email);
    const job = await api.post(`/api/projects/${p.id}/emails/batch`).send({ emails: [
      { key: 'invite:a', type: 'vendor_invite', projectFactoryId: alpha.id, subject: 'Hi Alpha', body: 'Quote: [Portal Link]' },
      { key: 'revision:b', type: 'revision_request', projectFactoryId: beta.id, subject: 'B&F', body: 'By [Due Date]: [Portal Link]', dueDate: '2026-10-15' },
    ] });
    expect(job.status).toBe(202);
    expect(fake.sent).toHaveLength(0); // nothing sent inside the request
    await drainJobs();
    const done = (await api.get(`/api/jobs/${job.body.id}`)).body;
    expect(done).toMatchObject({ state: 'succeeded', progress: 100, result: { sent: 2, failed: [], total: 2 } });
    expect(fake.sent.map((m) => m.to[0])).toEqual(['alpha@factory.test', 'beta@factory.test']);
    expect(fake.sent[1]!.text).toContain('October 15, 2026');
    const log = await pool.query('SELECT item_key, sent_via FROM email_log WHERE job_id = $1 ORDER BY id', [job.body.id]);
    expect(log.rows).toEqual([{ item_key: 'invite:a', sent_via: 'outlook' }, { item_key: 'revision:b', sent_via: 'outlook' }]);

    // A retried job (e.g. the server restarted mid-batch) never re-sends.
    await pool.query(`UPDATE jobs SET state = 'queued', attempts = 0 WHERE id = $1`, [job.body.id]);
    await drainJobs();
    expect(fake.sent).toHaveLength(2);
  });

  it('checks every email before sending any (a bad row fails the whole batch up front)', async () => {
    const { u, p, api, alpha, beta } = await buyer();
    await connect(u.token, u.email);
    const res = await api.post(`/api/projects/${p.id}/emails/batch`).send({ emails: [
      { key: 'a', type: 'vendor_invite', projectFactoryId: alpha.id, subject: 's', body: 'b' },
      { key: 'b', type: 'revision_request', projectFactoryId: beta.id, subject: 's', body: 'Due [Due Date]' }, // no date picked
    ] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/due date for Beta/);
    expect((await pool.query('SELECT count(*)::int AS n FROM jobs WHERE project_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('cannot batch-email factories on someone else\'s project', async () => {
    const { p, alpha } = await buyer();
    const other = await makeUser(await makeOrg());
    const res = await as(other.token).post(`/api/projects/${p.id}/emails/batch`)
      .send({ emails: [{ key: 'a', type: 'vendor_invite', projectFactoryId: alpha.id, subject: 's', body: 'b' }] });
    expect(res.status).toBe(404);
  });

  it('stops early with a clear reason when the Outlook connection has expired', async () => {
    const { u, p, api, alpha, beta } = await buyer();
    await connect(u.token, u.email);
    const job = await api.post(`/api/projects/${p.id}/emails/batch`).send({ emails: [
      { key: 'a', type: 'vendor_invite', projectFactoryId: alpha.id, subject: 's', body: 'b' },
      { key: 'b', type: 'vendor_invite', projectFactoryId: beta.id, subject: 's', body: 'b' },
    ] });
    fake.revoked.add(u.email);
    await pool.query(`UPDATE mail_accounts SET access_expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.user.id]);
    await drainJobs();
    const done = (await api.get(`/api/jobs/${job.body.id}`)).body;
    expect(done.result.sent).toBe(0);
    expect(done.result.failed).toHaveLength(2);
    expect(done.result.failed[0].error).toMatch(/Reconnect it in Settings/);
    expect(fake.refreshes).toBe(1); // didn't hammer Microsoft for every remaining email
    expect((await as(u.token).get('/api/mail/status')).body.connected).toBe(false);
  });
});
