// Building the compare sheet (manual, Excel, concurrency) and editing it
// without losing data.
import { describe, expect, it } from 'vitest';
import { anon, as, drainJobs, invite, makeOrg, makeProject, makeUser, xlsx } from '../helpers.js';

async function setup() {
  const org = await makeOrg();
  const u = await makeUser(org);
  const p = await makeProject(u.token);
  return { u, p, api: as(u.token) };
}

describe('items', () => {
  it('creates, partially updates, soft-deletes and restores an item', async () => {
    const { p, api } = await setup();
    const created = await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H1', description: '20oz tumbler', moq: '5,000', targetPrice: '3.25' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ styleNum: 'H1', moq: 5000, targetPrice: 3.25, position: 0 });
    const id = created.body.id;

    // Partial update: only moq changes; nothing else is wiped.
    const upd = await api.patch(`/api/projects/${p.id}/items/${id}`).send({ moq: 0 });
    expect(upd.body).toMatchObject({ styleNum: 'H1', description: '20oz tumbler', moq: 0, targetPrice: 3.25 });

    expect((await api.delete(`/api/projects/${p.id}/items/${id}`)).status).toBe(204);
    expect((await api.get(`/api/projects/${p.id}/items`)).body).toHaveLength(0);
    expect((await api.get(`/api/projects/${p.id}/items/deleted`)).body[0].id).toBe(id);
    expect((await api.post(`/api/projects/${p.id}/items/${id}/restore`)).status).toBe(200);
    expect((await api.get(`/api/projects/${p.id}/items`)).body).toHaveLength(1);
  });

  it('validates input (no silent coercion of garbage)', async () => {
    const { p, api } = await setup();
    const res = await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'X', moq: 'lots' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/moq/);
  });

  it('assigns unique positions under concurrent creates (no MAX+1 race)', async () => {
    const { p, api } = await setup();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      api.post(`/api/projects/${p.id}/items`).send({ styleNum: `C${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const positions = results.map((r) => r.body.position).sort((a, b) => a - b);
    expect(positions).toEqual([...Array(12).keys()]);
  });
});

describe('Import Excel → items (background job)', () => {
  it('fills style, specs, MOQ and target price with no manual entry', async () => {
    const { p, api } = await setup();
    const file = xlsx([
      ['Factory Price Chart'],
      ['Style #', 'Description', 'Material', 'MOQ', 'Price 1'],
      ['HYD-300', '40oz quencher', 'Stainless steel', '2,000', '4.75'],
      ['HYD-400', '16oz kids bottle', 'Tritan', '8000', '$1.95'],
    ]);
    const job = await api.post(`/api/projects/${p.id}/items/import-excel`).attach('file', file, 'outbound.xlsx');
    expect(job.status).toBe(202);
    expect(job.body.state).toBe('queued');
    await drainJobs();
    const done = await api.get(`/api/jobs/${job.body.id}`);
    expect(done.body).toMatchObject({ state: 'succeeded', progress: 100, result: { created: 2 } });
    const items = (await api.get(`/api/projects/${p.id}/items`)).body;
    expect(items.map((i: { styleNum: string }) => i.styleNum)).toEqual(['HYD-300', 'HYD-400']);
    expect(items[0]).toMatchObject({ description: '40oz quencher, Stainless steel', moq: 2000, targetPrice: 4.75 });
    expect(items[1]).toMatchObject({ moq: 8000, targetPrice: 1.95 });
  });

  it('fails the job with a clear message for a sheet with no product rows', async () => {
    const { p, api } = await setup();
    const job = await api.post(`/api/projects/${p.id}/items/import-excel`).attach('file', xlsx([['just a title']]), 'empty.xlsx');
    await drainJobs();
    const done = await api.get(`/api/jobs/${job.body.id}`);
    expect(done.body.state).toBe('failed');
    expect(done.body.error).toMatch(/No product rows/);
  });

  it('rejects non-Excel uploads', async () => {
    const { p, api } = await setup();
    const res = await api.post(`/api/projects/${p.id}/items/import-excel`).attach('file', Buffer.from('hi'), 'notes.txt');
    expect(res.status).toBe(400);
  });
});

describe('compare sheet + winners + quote edits', () => {
  async function withQuotes() {
    const s = await setup();
    const item = (await s.api.post(`/api/projects/${s.p.id}/items`).send({ styleNum: 'H1', targetPrice: 3 })).body;
    const invs = await invite(s.u.token, s.p.id, ['Alpha', 'Beta', 'Gamma']);
    for (const [i, inv] of invs.entries()) {
      const r = await anon()
        .put(`/api/portal/${inv.token}/items/${item.id}`).send({ bidding: true, price: 3 + i * 0.1, moq: 1000 * (i + 1), leadTime: `${30 + i} days` });
      expect(r.status).toBe(200);
    }
    return { ...s, item, invs };
  }

  it('three factories quoting one product → three rows, each with its OWN moq/price', async () => {
    const { p, api } = await withQuotes();
    const cmp = (await api.get(`/api/projects/${p.id}/compare`)).body;
    expect(cmp.items).toHaveLength(1);
    const rows = cmp.items[0].quotes;
    expect(rows.map((q: { factory: { name: string } }) => q.factory.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(rows.map((q: { moq: number }) => q.moq)).toEqual([1000, 2000, 3000]);
    expect(rows.map((q: { price: number }) => q.price)).toEqual([3, 3.1, 3.2]);
    // Not submitted yet → flagged as drafts
    expect(rows.every((q: { factory: { submitted: boolean } }) => q.factory.submitted === false)).toBe(true);
  });

  it('saving notes / landed cost never wipes the winner, and vice versa (P0 data-loss bug)', async () => {
    const { p, api, item } = await withQuotes();
    const q = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes[0];
    await api.patch(`/api/projects/${p.id}/quotes/${q.id}`).send({ totalFob: 3.36, baseDutyPct: 0, sellPrice: 6.5 });
    await api.patch(`/api/projects/${p.id}/quotes/${q.id}`).send({ notes: 'best finish' });
    await api.put(`/api/projects/${p.id}/items/${item.id}/winner`).send({ quoteId: q.id });
    await api.patch(`/api/projects/${p.id}/quotes/${q.id}`).send({ unitsPerContainer: 15000 });
    const lc = (await api.get(`/api/projects/${p.id}/landed-cost`)).body;
    expect(lc.rows).toHaveLength(1);
    expect(lc.rows[0].inputs).toMatchObject({ totalFob: 3.36, baseDutyPct: 0, sellPrice: 6.5, unitsPerContainer: 15000 });
    const again = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes[0];
    expect(again).toMatchObject({ notes: 'best finish', isWinner: true });
    expect(lc.rows[0].computed.landed).toBeGreaterThan(3.36);
  });

  it('winner selection is atomic: switching winners leaves exactly one', async () => {
    const { p, api, item } = await withQuotes();
    const qs = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes;
    await Promise.all(qs.map((q: { id: number }) => api.put(`/api/projects/${p.id}/items/${item.id}/winner`).send({ quoteId: q.id })));
    const after = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes;
    expect(after.filter((q: { isWinner: boolean }) => q.isWinner)).toHaveLength(1);
    await api.put(`/api/projects/${p.id}/items/${item.id}/winner`).send({ quoteId: null });
    const cleared = (await api.get(`/api/projects/${p.id}/compare`)).body.items[0].quotes;
    expect(cleared.some((q: { isWinner: boolean }) => q.isWinner)).toBe(false);
  });

  it('refuses a winner that belongs to a different item', async () => {
    const { p, api, item } = await withQuotes();
    const other = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H2' })).body;
    const q = (await api.get(`/api/projects/${p.id}/compare`)).body.items.find((i: { id: number }) => i.id === item.id).quotes[0];
    expect((await api.put(`/api/projects/${p.id}/items/${other.id}/winner`).send({ quoteId: q.id })).status).toBe(400);
  });

  it('soft-deleted items (and their quotes) drop off the compare sheet', async () => {
    const { p, api, item } = await withQuotes();
    await api.delete(`/api/projects/${p.id}/items/${item.id}`);
    expect((await api.get(`/api/projects/${p.id}/compare`)).body.items).toHaveLength(0);
  });
});
