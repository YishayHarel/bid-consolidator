// Organization administration (admins only, except reading your own org):
// settings (landed-cost constants, sign-up domains, branding), members & roles,
// and invites.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool, query, queryOne } from '../../db/pool.js';
import { newOpaqueToken } from '../../lib/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { email, id, parseBody, parseParams } from '../../lib/validate.js';
import { effectiveSettings } from '../../domain/landedCost.js';
import { currentUser, requireAdmin, requireAuth } from '../../middleware/auth.js';
import { orgDTO, type OrgRow } from '../auth/service.js';

export const orgRouter = Router();
orgRouter.use(requireAuth);

const orgFull = (o: OrgRow) => ({
  ...orgDTO(o),
  allowedDomains: o.allowed_domains,
  landedCost: effectiveSettings(o.settings, null),
});

orgRouter.get('/', async (req, res) => {
  const org = await queryOne<OrgRow>(pool, 'SELECT * FROM organizations WHERE id = $1', [currentUser(req).orgId]);
  if (!org) throw notFound('Organization');
  res.json(orgFull(org));
});

const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'must be a domain like example.com');
orgRouter.patch('/', requireAdmin, async (req, res) => {
  const body = parseBody(req, z.object({
    name: z.string().trim().min(1).max(255).optional(),
    branding: z.object({
      mark: z.string().trim().max(8).optional(),
      title: z.string().trim().max(255).optional(),
      subtitle: z.string().trim().max(255).optional(),
      color: z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a hex color like #0f172a').optional(),
    }).optional(),
    allowedDomains: z.array(domain).max(20).optional(),
    landedCost: z.object({
      commissionDivisor: z.number().positive().max(10).optional(),
      freightPerContainer: z.number().min(0).max(1_000_000).optional(),
      defaultEtc: z.number().min(0).max(1000).optional(),
    }).optional(),
  }));
  const u = currentUser(req);
  const org = await queryOne<OrgRow>(
    pool,
    `UPDATE organizations SET
       name = COALESCE($2, name),
       logo_mark = COALESCE($3, logo_mark), logo_title = COALESCE($4, logo_title),
       logo_sub = COALESCE($5, logo_sub), brand_color = COALESCE($6, brand_color),
       allowed_domains = COALESCE($7, allowed_domains),
       settings = CASE WHEN $8::jsonb IS NULL THEN settings
                       ELSE jsonb_set(settings, '{landedCost}', COALESCE(settings->'landedCost', '{}'::jsonb) || $8::jsonb) END
     WHERE id = $1 RETURNING *`,
    [u.orgId, body.name ?? null, body.branding?.mark ?? null, body.branding?.title ?? null, body.branding?.subtitle ?? null,
     body.branding?.color ?? null, body.allowedDomains ? [...new Set(body.allowedDomains)] : null,
     body.landedCost ? JSON.stringify(body.landedCost) : null],
  );
  res.json(orgFull(org!));
});

// ---- Members ----------------------------------------------------------------
orgRouter.get('/members', requireAdmin, async (req, res) => {
  const rows = await query(pool, 'SELECT id, email, name, role, created_at FROM users WHERE org_id = $1 ORDER BY name', [currentUser(req).orgId]);
  res.json(rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at })));
});

orgRouter.patch('/members/:userId', requireAdmin, async (req, res) => {
  const { userId } = parseParams(req, z.object({ userId: id }));
  const { role } = parseBody(req, z.object({ role: z.enum(['admin', 'member']) }));
  const u = currentUser(req);
  if (role === 'member') {
    const admins = await queryOne<{ n: number }>(pool, `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND id <> $2`, [u.orgId, userId]);
    if (!admins?.n) throw conflict('An organization needs at least one admin.');
  }
  const row = await queryOne(pool, 'UPDATE users SET role = $3 WHERE id = $1 AND org_id = $2 RETURNING id, email, name, role', [userId, u.orgId, role]);
  if (!row) throw notFound('Member');
  res.json(row);
});

// ---- Invites ----------------------------------------------------------------
orgRouter.get('/invites', requireAdmin, async (req, res) => {
  const rows = await query(
    pool,
    `SELECT id, email, role, expires_at, used_at, created_at FROM org_invites
      WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [currentUser(req).orgId],
  );
  res.json(rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expires_at, usedAt: r.used_at, createdAt: r.created_at })));
});

orgRouter.post('/invites', requireAdmin, async (req, res) => {
  const body = parseBody(req, z.object({ email, role: z.enum(['admin', 'member']).default('member') }));
  const u = currentUser(req);
  const existing = await queryOne(pool, 'SELECT 1 FROM users WHERE lower(email) = $1', [body.email]);
  if (existing) throw badRequest('That person already has an account.');
  const { token, hash } = newOpaqueToken();
  const row = await queryOne(
    pool,
    `INSERT INTO org_invites (org_id, email, role, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + interval '14 days', $5) RETURNING id, email, role, expires_at`,
    [u.orgId, body.email, body.role, hash, u.id],
  );
  // The raw token is shown once (in this response); only its hash is stored.
  res.status(201).json({
    id: row!.id, email: row!.email, role: row!.role, expiresAt: row!.expires_at,
    inviteUrl: `${config.appUrl}/admin?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(body.email)}`,
  });
});

orgRouter.delete('/invites/:inviteId', requireAdmin, async (req, res) => {
  const { inviteId } = parseParams(req, z.object({ inviteId: id }));
  const r = await pool.query('DELETE FROM org_invites WHERE id = $1 AND org_id = $2', [inviteId, currentUser(req).orgId]);
  if (!r.rowCount) throw notFound('Invite');
  res.status(204).end();
});
