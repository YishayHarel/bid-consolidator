// Shared helpers for integration tests: an in-process app, isolated orgs and
// users per test, spreadsheet builders, and job draining.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { newOpaqueToken } from '../src/lib/auth.js';
import { drainJobs } from '../src/lib/jobs.js';
import '../src/modules/jobs/handlers.js';

// ONE listening server per test file. Passing the bare Express app to supertest
// spins up a new ephemeral server per request; across ~1,000 requests a port
// can be reused while an old keep-alive socket still points at it, which
// surfaces as a random "Parse Error: Expected HTTP/". A single server removes
// that race entirely.
export const app = http.createServer(createApp()).listen(0);
afterAll(() => new Promise<void>((resolve) => { app.closeAllConnections(); app.close(() => resolve()); }));
export { pool, drainJobs };

/** A fresh organization with its own email domain (full isolation per test). */
export async function makeOrg(name = 'Org') {
  const domain = `${randomUUID().slice(0, 8)}.example-co.com`;
  const org = await queryOne<{ id: number }>(pool,
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [`${name} ${domain}`]);
  return { id: org!.id, domain };
}

/** An unused invite into an org, returning the raw token (as an admin would share it). */
export async function makeInvite(org: { id: number }, email: string, role: 'admin' | 'member' = 'member') {
  const { token, hash } = newOpaqueToken();
  await pool.query(
    `INSERT INTO org_invites (org_id, email, role, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
    [org.id, email, role, hash]);
  return token;
}

/** Register a user in an org (via an invite and the real sign-up endpoint). */
export async function makeUser(org: { id: number; domain: string }, opts: { admin?: boolean; name?: string } = {}) {
  const email = `${randomUUID().slice(0, 8)}@${org.domain}`;
  const inviteToken = await makeInvite(org, email);
  const res = await request(app).post('/api/auth/register').send({ name: opts.name ?? 'Tester', email, password: 'correct-horse-battery', inviteToken });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (opts.admin) {
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [res.body.user.id]);
    const again = await request(app).post('/api/auth/login').send({ email, password: 'correct-horse-battery' });
    return { token: again.body.token as string, user: again.body.user, email };
  }
  return { token: res.body.token as string, user: res.body.user, email };
}

/** Authenticated request helpers. */
export function as(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string) => auth(request(app).post(url)),
    put: (url: string) => auth(request(app).put(url)),
    patch: (url: string) => auth(request(app).patch(url)),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}
export const anon = () => request(app);

export async function makeProject(token: string, body: Record<string, unknown> = {}) {
  const res = await as(token).post('/api/projects').send({ name: 'Test Project', division: 'Hydration', ...body });
  if (res.status !== 201) throw new Error(`create project failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; name: string; division: string };
}

/** Build an .xlsx buffer from rows (first row may be a title like "Factory Name: X"). */
export function xlsx(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Invite factories to a project; returns invitations with portal tokens. */
export async function invite(token: string, projectId: number, names: string[]) {
  const res = await as(token).post(`/api/projects/${projectId}/factories`)
    .send({ newFactories: names.map((n) => ({ name: n, emails: [`${n.toLowerCase().replace(/\W+/g, '')}@factory.test`] })) });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body.factories as { id: number; factory: { name: string }; portalUrl: string }[]).map((f) => ({
    ...f,
    token: new URL(f.portalUrl).searchParams.get('token')!,
  }));
}
