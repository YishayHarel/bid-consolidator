import { beforeEach, describe, expect, it } from 'vitest';
import { testOutbox } from '../../src/lib/mailer.js';
import { anon, as, invite, makeOrg, makeProject, makeUser, pool } from '../helpers.js';

beforeEach(() => { testOutbox.length = 0; });

async function competitive() {
  const org = await makeOrg();
  const u = await makeUser(org, { name: 'Jack' });
  const p = await makeProject(u.token, { name: 'Billabong' });
  const api = as(u.token);
  const item = (await api.post(`/api/projects/${p.id}/items`).send({ styleNum: 'H1', targetPrice: 1.5 })).body;
  const [alpha, beta] = await invite(u.token, p.id, ['Alpha', 'Beta']);
  await anon().put(`/api/portal/${alpha!.token}/items/${item.id}`).send({ bidding: true, price: 2.0 });
  await anon().put(`/api/portal/${beta!.token}/items/${item.id}`).send({ bidding: true, price: 2.5 });
  return { u, p, api, alpha: alpha!, beta: beta! };
}

describe('email drafts', () => {
  it('are read-only: loading drafts creates no portal links (old GET minted tokens)', async () => {
    const { p, api } = await competitive();
    const before = await pool.query('SELECT count(*)::int AS n FROM vendor_tokens');
    await api.get(`/api/projects/${p.id}/emails/drafts`);
    await api.get(`/api/projects/${p.id}/emails/drafts`);
    const after = await pool.query('SELECT count(*)::int AS n FROM vendor_tokens');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('build Best & Final only for the factory above the lowest price — never revealing the target', async () => {
    const { p, api } = await competitive();
    const { drafts } = (await api.get(`/api/projects/${p.id}/emails/drafts`)).body;
    const revisions = drafts.filter((d: { type: string }) => d.type === 'revision_request');
    expect(revisions.map((d: { factoryName: string }) => d.factoryName)).toEqual(['Beta']);
    expect(revisions[0].body).toContain('(25.0% higher)');
    expect(revisions[0].body).toContain('$2.00');
    expect(revisions[0].body).not.toContain('1.50'); // internal target price stays internal
    expect(revisions[0].body).toContain('[Portal Link]'); // filled in at send time
  });
});

describe('sending email', () => {
  it('goes to the factory\'s addresses on file — the request cannot choose recipients', async () => {
    const { p, api, alpha } = await competitive();
    const res = await api.post(`/api/projects/${p.id}/emails/send`).send({
      type: 'vendor_invite', projectFactoryId: alpha.id, subject: 'Quote', body: 'Hi, quote here: [Portal Link]',
      to: 'victim@bank.com', // ignored: not part of the contract
    });
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(1);
    expect(testOutbox[0]!.to).toEqual(['alpha@factory.test']);
    expect(testOutbox[0]!.text).toMatch(/\/vendor\?token=[0-9a-f-]{36}/);
    expect(testOutbox[0]!.text).not.toContain('[Portal Link]');
  });

  it('cannot email a factory on someone else\'s project', async () => {
    const a = await competitive();
    const other = await makeUser(await makeOrg());
    const res = await as(other.token).post(`/api/projects/${a.p.id}/emails/send`)
      .send({ type: 'vendor_invite', projectFactoryId: a.alpha.id, subject: 'x', body: 'y' });
    expect(res.status).toBe(404);
    expect(testOutbox).toHaveLength(0);
  });

  it('Best & Final gets a FRESH revision link even after the factory already submitted', async () => {
    const { p, api, beta } = await competitive();
    await anon().post(`/api/portal/${beta.token}/submit`);
    const noDate = await api.post(`/api/projects/${p.id}/emails/send`)
      .send({ type: 'revision_request', projectFactoryId: beta.id, subject: 'B&F', body: 'Revise by [Due Date]: [Portal Link]' });
    expect(noDate.status).toBe(400);
    const res = await api.post(`/api/projects/${p.id}/emails/send`).send({
      type: 'revision_request', projectFactoryId: beta.id, subject: 'B&F', body: 'Revise by [Due Date]: [Portal Link]', dueDate: '2026-10-15',
    });
    expect(res.status).toBe(200);
    expect(testOutbox[0]!.text).toContain('October 15, 2026');
    const token = testOutbox[0]!.text.match(/token=([0-9a-f-]{36})/)![1]!;
    const view = (await anon().get(`/api/portal/${token}`)).body;
    expect(view).toMatchObject({ status: 'valid', purpose: 'revision', factoryName: 'Beta' });
  });

  it('prepares a real portal link on request (for copying into your own mail client)', async () => {
    const { p, api, beta } = await competitive();
    const res = await api.post(`/api/projects/${p.id}/emails/link`).send({ projectFactoryId: beta.id, type: 'revision_request' });
    expect(res.status).toBe(200);
    const token = new URL(res.body.portalUrl).searchParams.get('token')!;
    expect((await anon().get(`/api/portal/${token}`)).body.purpose).toBe('revision');
    // Asking again reuses the same unused link rather than minting another.
    const again = await api.post(`/api/projects/${p.id}/emails/link`).send({ projectFactoryId: beta.id, type: 'revision_request' });
    expect(again.body.portalUrl).toBe(res.body.portalUrl);
  });

  it('logs every send so "last emailed" survives a refresh', async () => {
    const { p, api, alpha } = await competitive();
    await api.post(`/api/projects/${p.id}/emails/send`).send({ type: 'vendor_invite', projectFactoryId: alpha.id, subject: 's', body: '[Portal Link]' });
    const invited = (await api.get(`/api/projects/${p.id}/factories`)).body.find((f: { id: number }) => f.id === alpha.id);
    expect(invited.lastEmailedAt).toBeTruthy();
  });

  it('refuses to email a factory with no address on file', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const p = await makeProject(u.token);
    const res = await as(u.token).post(`/api/projects/${p.id}/factories`).send({ newFactories: [{ name: 'No Email Co' }] });
    const pf = res.body.factories[0];
    const send = await as(u.token).post(`/api/projects/${p.id}/emails/send`).send({ type: 'vendor_invite', projectFactoryId: pf.id, subject: 's', body: 'b' });
    expect(send.status).toBe(400);
    expect(send.body.error).toMatch(/No email address on file/);
  });
});

describe('email templates are personal', () => {
  it('a user\'s saved format overrides the default only for them, and can be reset', async () => {
    const org = await makeOrg();
    const a = await makeUser(org);
    const b = await makeUser(org);
    await as(a.token).put('/api/email-templates/vendor_invite').send({ subject: 'Custom [Project Name]', body: 'Hey [Contact Name]!' });
    const aT = (await as(a.token).get('/api/email-templates')).body.find((t: { type: string }) => t.type === 'vendor_invite');
    const bT = (await as(b.token).get('/api/email-templates')).body.find((t: { type: string }) => t.type === 'vendor_invite');
    expect(aT).toMatchObject({ subject: 'Custom [Project Name]', isCustom: true });
    expect(bT.isCustom).toBe(false);
    const reset = await as(a.token).delete('/api/email-templates/vendor_invite');
    expect(reset.body.isCustom).toBe(false);
  });
});
