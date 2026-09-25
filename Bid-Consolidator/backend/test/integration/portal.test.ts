// The factory-facing portal and factory Excel uploads.
import { describe, expect, it } from 'vitest';
import { anon, as, drainJobs, invite, makeOrg, makeProject, makeUser, pool, xlsx } from '../helpers.js';

async function setup(division = 'Hydration') {
  const org = await makeOrg();
  const u = await makeUser(org);
  const p = await makeProject(u.token, { division });
  const api = as(u.token);
  const h1 = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H1', description: '20oz bottle', moq: 5000, targetPrice: 2.5, innerPack: 6, masterPack: 24 })).body;
  const h2 = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H2', description: '32oz bottle', moq: 3000, targetPrice: 3.5 })).body;
  return { u, p, api, h1, h2 };
}

describe('factory portal (link = credential, sealed per factory)', () => {
  it('shows the sheet with our specs but never our target price or other factories\' quotes', async () => {
    const { u, p, h1 } = await setup();
    const [alpha, beta] = await invite(u.token, p.id, ['Alpha', 'Beta']);
    await anon().put(`/api/portal/${alpha!.token}/items/${h1.id}`).send({ bidding: true, price: 1.99, moq: 1000 });
    const view = await anon().get(`/api/portal/${beta!.token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ status: 'valid', factoryName: 'Beta', purpose: 'quote' });
    expect(view.body.items).toHaveLength(2);
    expect(view.body.items[0]).toMatchObject({ styleNum: 'H1', targetMoq: 5000, quote: null }); // Alpha's quote invisible
    expect(JSON.stringify(view.body)).not.toMatch(/targetPrice|2\.5\b|1\.99/);
  });

  it('Inner/Master pack counts appear for GM projects only', async () => {
    const hyd = await setup('Hydration');
    const [f1] = await invite(hyd.u.token, hyd.p.id, ['F1']);
    expect((await anon().get(`/api/portal/${f1!.token}`)).body.items[0]).not.toHaveProperty('innerPack');
    const gm = await setup('General');
    const [f2] = await invite(gm.u.token, gm.p.id, ['F2']);
    const item = (await anon().get(`/api/portal/${f2!.token}`)).body.items[0];
    expect(item).toMatchObject({ innerPack: 6, masterPack: 24 });
  });

  it('autosave upserts; the owner\'s notes and winner survive a factory edit', async () => {
    const { u, p, api, h1 } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 2.2, moq: 1000 });
    const q = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes[0];
    await api.patch(`/api/projects/${p.id}/quotes/${q.id}`).send({ notes: 'keep me' });
    await api.put(`/api/projects/${p.id}/items/${h1.id}/winner`).send({ quoteId: q.id });
    // factory revises its price
    await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 2.05, moq: 1200, leadTime: '40 days' });
    const after = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: q.id, price: 2.05, moq: 1200, leadTime: '40 days', notes: 'keep me', isWinner: true });
  });

  it('un-bidding withdraws the quote; invalid input is rejected', async () => {
    const { u, p, api, h1 } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 2 });
    await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: false });
    expect((await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes).toHaveLength(0);
    expect((await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 'cheap' })).status).toBe(400);
    expect((await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: -1 })).status).toBe(400);
  });

  it('cannot quote on an item from another project', async () => {
    const a = await setup();
    const b = await setup();
    const [f] = await invite(a.u.token, a.p.id, ['Alpha']);
    expect((await anon().put(`/api/portal/${f!.token}/items/${b.h1.id}`).send({ bidding: true, price: 1 })).status).toBe(404);
  });

  it('submit is single-use, marks the factory submitted, and blocks further edits', async () => {
    const { u, p, api, h1 } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 2 });
    expect((await anon().post(`/api/portal/${f!.token}/submit`)).status).toBe(200);
    expect((await anon().post(`/api/portal/${f!.token}/submit`)).status).toBe(410);
    expect((await anon().put(`/api/portal/${f!.token}/items/${h1.id}`).send({ bidding: true, price: 1 })).status).toBe(410);
    expect((await anon().get(`/api/portal/${f!.token}`)).body.status).toBe('used');
    const invited = (await api.get(`/api/projects/${p.id}/factories`)).body[0];
    expect(invited).toMatchObject({ status: 'submitted', itemsReceived: 1, totalItems: 2 });
    const q = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes[0];
    expect(q.factory.submitted).toBe(true);
  });

  it('expired and unknown links are refused', async () => {
    const { u, p } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    await pool.query(`UPDATE vendor_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1`, [f!.token]);
    expect((await anon().get(`/api/portal/${f!.token}`)).body.status).toBe('expired');
    expect((await anon().get('/api/portal/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await anon().get('/api/portal/not-a-uuid')).status).toBe(404);
  });

  it('a fresh link can be issued after the old one was used', async () => {
    const { u, p, api } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    await anon().post(`/api/portal/${f!.token}/submit`);
    const fresh = await api.post(`/api/projects/${p.id}/factories/${f!.id}/link`);
    expect(fresh.status).toBe(201);
    const token = new URL(fresh.body.portalUrl).searchParams.get('token')!;
    expect((await anon().get(`/api/portal/${token}`)).body.status).toBe('valid');
  });
});

describe('factory Excel quote uploaded by the owner', () => {
  it('matches rows to items, keeps unmatched rows, and marks the factory submitted', async () => {
    const { u, p, api } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    const job = await api.post(`/api/projects/${p.id}/quotes/import`).field('projectFactoryId', String(f!.id))
      .attach('file', xlsx([
        ['Factory Name: Alpha'],
        ['Style #', 'Description', 'MOQ', 'Price 1'],
        ['h1', '20oz bottle', '1,500', '2.10'],        // style match (case-insensitive)
        ['', '32oz bottle, powder coat', '800', '3.05'], // name match
        ['ZZ9', 'dog leash', '10', '1.00'],            // unmatched → kept for manual assignment
      ]), 'alpha-quote.xlsx');
    expect(job.status).toBe(202);
    await drainJobs();
    expect((await api.get(`/api/jobs/${job.body.id}`)).body.result).toMatchObject({ rows: 3, matched: 2, unmatched: 1 });
    const cmp = (await api.get(`/api/projects/${p.id}/compare`)).body;
    expect(cmp.items[0].quotes[0]).toMatchObject({ price: 2.1, moq: 1500 });
    expect(cmp.items[1].quotes[0]).toMatchObject({ price: 3.05, moq: 800 });
    expect(cmp.unmatched).toHaveLength(1);
    expect(cmp.unmatched[0]).toMatchObject({ styleNum: 'ZZ9', itemId: null });
    expect((await api.get(`/api/projects/${p.id}/factories`)).body[0].status).toBe('submitted');

    // The owner assigns the unmatched row to an item by hand.
    const extra = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'ZZ9', description: 'dog leash' })).body;
    const assigned = await api.patch(`/api/projects/${p.id}/quotes/${cmp.unmatched[0].id}`).send({ itemId: extra.id });
    expect(assigned.body.itemId).toBe(extra.id);
  });

  it('re-uploading replaces prices but keeps notes/winner, and withdraws dropped items', async () => {
    const { u, p, api, h1 } = await setup();
    const [f] = await invite(u.token, p.id, ['Alpha']);
    const upload = (rows: (string | number)[][]) =>
      api.post(`/api/projects/${p.id}/quotes/import`).field('projectFactoryId', String(f!.id))
        .attach('file', xlsx([['Style #', 'Description', 'MOQ', 'Price'], ...rows]), 'q.xlsx');
    await upload([['H1', '20oz bottle', 1000, 2.2], ['H2', '32oz bottle', 1000, 3.3]]);
    await drainJobs();
    const q1 = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes[0];
    await api.patch(`/api/projects/${p.id}/quotes/${q1.id}`).send({ notes: 'great sample', totalFob: 2.4 });
    await api.put(`/api/projects/${p.id}/items/${h1.id}/winner`).send({ quoteId: q1.id });

    await upload([['H1', '20oz bottle', 900, 1.95]]); // H2 dropped
    await drainJobs();
    const cmp = (await api.get(`/api/projects/${p.id}/compare`)).body;
    expect(cmp.items[0].quotes[0]).toMatchObject({ id: q1.id, price: 1.95, moq: 900, notes: 'great sample', isWinner: true });
    expect(cmp.items[1].quotes).toHaveLength(0);
  });

  it('seeds the item list from the first factory sheet when the project has none', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const p = await makeProject(u.token);
    const api = as(u.token);
    const job = await api.post(`/api/projects/${p.id}/quotes/import`).field('factoryName', 'Walk-in Factory')
      .attach('file', xlsx([['Style #', 'Description', 'Price'], ['Q1', 'cooler bag', 5], ['Q2', 'lunch box', 4]]), 'q.xlsx');
    expect(job.status).toBe(202);
    await drainJobs();
    const cmp = (await api.get(`/api/projects/${p.id}/compare`)).body;
    expect(cmp.items.map((i: { styleNum: string }) => i.styleNum)).toEqual(['Q1', 'Q2']);
    expect(cmp.items.map((i: { position: number }) => i.position)).toEqual([0, 1]); // no off-by-one
    expect(cmp.items[0].quotes[0].factory.name).toBe('Walk-in Factory');
  });
});
