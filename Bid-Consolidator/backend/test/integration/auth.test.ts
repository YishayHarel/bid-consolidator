import { describe, expect, it } from 'vitest';
import { anon, as, makeInvite, makeOrg, makeUser, pool } from '../helpers.js';

describe('sign-up is invite-only', () => {
  it('refuses sign-up without an invite, even at a domain the org uses', async () => {
    const org = await makeOrg();
    await makeUser(org); // someone already at this domain
    for (const email of ['x@gmail.com', `new@${org.domain}`]) {
      const res = await anon().post('/api/auth/register').send({ name: 'Stranger', email, password: 'long-enough-pw' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/invite/i);
    }
    const legacyDomains = await pool.query(`UPDATE organizations SET allowed_domains = ARRAY[$2] WHERE id = $1`, [org.id, org.domain]);
    expect(legacyDomains.rowCount).toBe(1); // a leftover sign-up domain in the DB grants nothing
    const res = await anon().post('/api/auth/register').send({ name: 'S', email: `other@${org.domain}`, password: 'long-enough-pw' });
    expect(res.status).toBe(400);
  });

  it('accepts an invite, joining that org with the invited role', async () => {
    const org = await makeOrg();
    const email = `emp@${org.domain}`;
    const inviteToken = await makeInvite(org, email);
    const res = await anon().post('/api/auth/register').send({ name: 'Emp', email, password: 'long-enough-pw', inviteToken });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'member', orgId: org.id });
    expect(res.body.token).toBeTruthy();
  });

  it('enforces password length and rejects duplicate accounts', async () => {
    const org = await makeOrg();
    const email = `a@${org.domain}`;
    const t1 = await makeInvite(org, email);
    expect((await anon().post('/api/auth/register').send({ name: 'A', email, password: 'short', inviteToken: t1 })).status).toBe(400);
    expect((await anon().post('/api/auth/register').send({ name: 'A', email, password: 'long-enough-pw', inviteToken: t1 })).status).toBe(201);
    const t2 = await makeInvite(org, `A@${org.domain}`);
    const dup = await anon().post('/api/auth/register').send({ name: 'A', email: `A@${org.domain}`, password: 'long-enough-pw', inviteToken: t2 });
    expect(dup.status).toBe(409);
  });

  it('lets an admin invite someone from any domain, bound to that exact email', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org, { admin: true });
    const inv = await as(admin.token).post('/api/org/invites').send({ email: 'partner@outside.io', role: 'member' });
    expect(inv.status).toBe(201);
    const inviteToken = new URL(inv.body.inviteUrl).searchParams.get('invite')!;
    const wrong = await anon().post('/api/auth/register').send({ name: 'Other', email: 'other@outside.io', password: 'long-enough-pw', inviteToken });
    expect(wrong.status).toBe(403);
    const ok = await anon().post('/api/auth/register').send({ name: 'Partner', email: 'partner@outside.io', password: 'long-enough-pw', inviteToken });
    expect(ok.status).toBe(201);
    expect(ok.body.user.orgId).toBe(org.id);
    const reuse = await anon().post('/api/auth/register').send({ name: 'P2', email: 'partner@outside.io', password: 'long-enough-pw', inviteToken });
    expect(reuse.status).toBe(400); // single-use
  });

  it('only admins manage invites and org settings', async () => {
    const org = await makeOrg();
    const member = await makeUser(org);
    expect((await as(member.token).post('/api/org/invites').send({ email: 'x@y.com' })).status).toBe(403);
    expect((await as(member.token).patch('/api/org').send({ name: 'Hacked' })).status).toBe(403);
  });
});

describe('login', () => {
  it('shows one clear message for wrong password AND unknown email (no enumeration)', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const wrongPw = await anon().post('/api/auth/login').send({ email: u.email, password: 'nope-nope-nope' });
    const noUser = await anon().post('/api/auth/login').send({ email: `ghost@${org.domain}`, password: 'whatever-1234' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error).toBe(noUser.body.error);
    expect(wrongPw.body.error).toMatch(/incorrect email or password/i);
  });

  it('logs in case-insensitively and /me returns user + org branding', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    const res = await anon().post('/api/auth/login').send({ email: u.email.toUpperCase(), password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    const me = await as(res.body.token).get('/api/auth/me');
    expect(me.body.user.email).toBe(u.email);
    expect(me.body.org.branding).toHaveProperty('title');
  });

  it('changes password (requires the current one)', async () => {
    const org = await makeOrg();
    const u = await makeUser(org);
    expect((await as(u.token).post('/api/auth/password').send({ currentPassword: 'wrong', newPassword: 'brand-new-password' })).status).toBe(400);
    expect((await as(u.token).post('/api/auth/password').send({ currentPassword: 'correct-horse-battery', newPassword: 'brand-new-password' })).status).toBe(204);
    expect((await anon().post('/api/auth/login').send({ email: u.email, password: 'brand-new-password' })).status).toBe(200);
  });

  it('rejects missing/forged tokens', async () => {
    expect((await anon().get('/api/projects')).status).toBe(401);
    expect((await as('forged.token.value').get('/api/projects')).status).toBe(401);
  });
});

describe('admins', () => {
  it('cannot demote the last admin', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org, { admin: true });
    const res = await as(admin.token).patch(`/api/org/members/${admin.user.id}`).send({ role: 'member' });
    expect(res.status).toBe(409);
  });

  it('configures landed-cost constants for the org', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org, { admin: true });
    const res = await as(admin.token).patch('/api/org').send({ landedCost: { freightPerContainer: 9000 } });
    expect(res.status).toBe(200);
    expect(res.body.landedCost).toEqual({ commissionDivisor: 1.12, freightPerContainer: 9000, defaultEtc: 0.1 });
  });
});
