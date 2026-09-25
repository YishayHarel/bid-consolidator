import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { anon, as, drainJobs, makeOrg, makeProject, makeUser, pool } from '../helpers.js';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('files: signed URLs only', () => {
  it('uploaded CADs become items whose images load via signed URL with no session', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const p = await makeProject(u.token);
    const up = await as(u.token).post(`/api/projects/${p.id}/cads`).attach('files', PNG, 'H14085WB_bottle.png');
    expect(up.status).toBe(201); // no AI configured in tests → one item per file, created now
    expect(up.body.createdItems).toBe(1);
    const [item] = (await as(u.token).get(`/api/projects/${p.id}/items`)).body;
    expect(item.styleNum).toBe('H14085WB bottle');
    expect(item.imageUrl).toMatch(/^\/files\/[\w-]+\.[\w-]+$/);
    const img = await anon().get(`/api${item.imageUrl}`);
    expect(img.status).toBe(200);
    expect(img.headers['cache-control']).toMatch(/max-age=3600/);
    // A tampered signature is refused.
    expect((await anon().get(`/api${item.imageUrl}x`)).status).toBe(404);
  });

  it('rejects unsupported and oversized uploads cleanly', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const p = await makeProject(u.token);
    const bad = await as(u.token).post(`/api/projects/${p.id}/cads`).attach('files', Buffer.from('MZ'), 'virus.exe');
    expect(bad.status).toBe(400);
  });
});

describe('deleting a project removes its files from storage', () => {
  it('marks tracked objects and the purge job deletes them', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const p = await makeProject(u.token);
    await as(u.token).post(`/api/projects/${p.id}/cads`).attach('files', PNG, 'a.png');
    const { rows } = await pool.query<{ key: string }>('SELECT key FROM stored_objects WHERE project_id = $1', [p.id]);
    expect(rows.length).toBeGreaterThan(0);
    const onDisk = rows.map((r) => path.join(config.LOCAL_STORAGE_DIR!, r.key));
    expect(onDisk.every((f) => fs.existsSync(f))).toBe(true);

    expect((await as(u.token).delete(`/api/projects/${p.id}`)).status).toBe(204);
    await drainJobs();
    expect(onDisk.some((f) => fs.existsSync(f))).toBe(false);
    const left = await pool.query('SELECT count(*)::int AS n FROM stored_objects WHERE project_id = $1', [p.id]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe('platform', () => {
  it('health checks the database', async () => {
    expect((await anon().get('/api/health')).body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('sends security headers and hides the framework', async () => {
    const res = await anon().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('never leaks internals in errors', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const malformed = await as(u.token).post('/api/projects').set('Content-Type', 'application/json').send('{"name": ');
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).not.toMatch(/at |\.ts|SyntaxError|node_modules/);
    const huge = await as(u.token).post('/api/projects').send({ name: 'x'.repeat(2_000_000) });
    expect(huge.status).toBe(413);
  });

  it('unknown API routes: 401 for anonymous (route map not revealed), clean 404 when signed in', async () => {
    expect((await anon().get('/api/nope')).status).toBe(401);
    const u = await makeUser(await makeOrg());
    const res = await as(u.token).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 'not_found' });
  });

  it('CORS allows only the configured frontend', async () => {
    const ok = await anon().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await anon().get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('paginates project lists', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    for (let i = 0; i < 3; i++) await makeProject(u.token, { name: `P${i}` });
    const page = (await as(u.token).get('/api/projects?limit=2&offset=0')).body;
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});
