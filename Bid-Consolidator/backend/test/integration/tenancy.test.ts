// Isolation: the class of bug behind the review's P0 findings. Nobody may read
// or act on another user's projects, portal links, jobs or files, and orgs
// never see each other's factory directories.
import { describe, expect, it } from 'vitest';
import { anon, as, invite, makeOrg, makeProject, makeUser } from '../helpers.js';

describe('projects are private to their owner', () => {
  it('another user in the same org gets 404 on every project route', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    const b = await makeUser(org);
    const p = await makeProject(a.token);
    const bAs = as(b.token);
    for (const res of await Promise.all([
      bAs.get(`/api/projects/${p.id}`),
      bAs.get(`/api/projects/${p.id}/compare`),
      bAs.get(`/api/projects/${p.id}/items`),
      bAs.get(`/api/projects/${p.id}/factories`),
      bAs.get(`/api/projects/${p.id}/emails/drafts`),
      bAs.get(`/api/projects/${p.id}/landed-cost`),
      bAs.patch(`/api/projects/${p.id}`).send({ name: 'x' }),
      bAs.delete(`/api/projects/${p.id}`),
    ])) expect(res.status).toBe(404);
    const list = await bAs.get('/api/projects');
    expect(list.body.items.map((x: { id: number }) => x.id)).not.toContain(p.id);
  });
});

describe('portal links never leak across accounts', () => {
  it('B cannot list, revoke, or re-issue A\'s factory links', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    const b = await makeUser(org);
    const p = await makeProject(a.token);
    const [inv] = await invite(a.token, p.id, ['Acme']);
    const bLinks = await as(b.token).get('/api/vendor-links');
    expect(bLinks.body).toEqual([]);
    const aLinks = await as(a.token).get('/api/vendor-links');
    expect(aLinks.body).toHaveLength(1);
    expect((await as(b.token).delete(`/api/vendor-links/${aLinks.body[0].id}`)).status).toBe(404);
    expect((await as(b.token).post(`/api/projects/${p.id}/factories/${inv!.id}/link`)).status).toBe(404);
  });
});

describe('factory directory is shared within an org, invisible to other orgs', () => {
  it('same-org users share it; another org sees none of it and cannot edit it', async () => {
    const org1 = await makeOrg();
    const org2 = await makeOrg();
    const a = await makeUser(org1);
    const a2 = await makeUser(org1);
    const z = await makeUser(org2);
    const f = await as(a.token).post('/api/factories').send({ name: 'Shared Co', emails: 'sales@shared.co', divisions: ['Hydration'] });
    expect(f.status).toBe(201);
    expect((await as(a2.token).get('/api/factories')).body.map((x: { name: string }) => x.name)).toContain('Shared Co');
    expect((await as(z.token).get('/api/factories')).body).toEqual([]);
    expect((await as(z.token).patch(`/api/factories/${f.body.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await as(z.token).delete(`/api/factories/${f.body.id}`)).status).toBe(404);
  });

  it('a factory in use cannot be deleted (its quotes would be orphaned)', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    const p = await makeProject(a.token);
    await invite(a.token, p.id, ['Busy Factory']);
    const list = await as(a.token).get('/api/factories');
    const busy = list.body.find((x: { name: string }) => x.name === 'Busy Factory');
    const res = await as(a.token).delete(`/api/factories/${busy.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/on 1 project/);
  });

  it('rejects duplicate names within an org (case-insensitive)', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    await as(a.token).post('/api/factories').send({ name: 'Dupe Ltd' });
    expect((await as(a.token).post('/api/factories').send({ name: 'DUPE LTD' })).status).toBe(409);
  });
});

describe('jobs are visible only to their owner', () => {
  it('another user cannot read someone else\'s job', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    const b = await makeUser(org);
    const p = await makeProject(a.token);
    const job = await as(a.token).post(`/api/projects/${p.id}/items/import-excel`).attach('file', Buffer.from('PK'), 'x.xlsx');
    expect(job.status).toBe(202);
    expect((await as(b.token).get(`/api/jobs/${job.body.id}`)).status).toBe(404);
    expect((await as(a.token).get(`/api/jobs/${job.body.id}`)).status).toBe(200);
  });
});

describe('legacy enumerable file endpoints are gone', () => {
  it('no /item-image, /quote-image or /cad/:id routes exist', async () => {
    for (const url of ['/api/projects/1/item-image/0/0', '/api/projects/1/quote-image/1', '/api/projects/1/cad/1']) {
      expect([401, 404]).toContain((await anon().get(url)).status);
    }
  });
});
