// All portal links across the user's own projects (Vendor Links tab). Links on
// other people's projects are never visible here.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { id, parseParams, parseQuery } from '../../lib/validate.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { portalUrl } from '../links/tokens.js';

export const vendorLinksRouter = Router();
vendorLinksRouter.use(requireAuth);

vendorLinksRouter.get('/', async (req, res) => {
  const { projectId } = parseQuery(req, z.object({ projectId: id.optional() }));
  const u = currentUser(req);
  const rows = await query(pool,
    `SELECT vt.id, vt.token, vt.purpose, vt.expires_at, vt.used_at, vt.created_at,
            p.id AS project_id, p.name AS project_name, pf.id AS project_factory_id, f.name AS factory_name
       FROM vendor_tokens vt
       JOIN project_factories pf ON pf.id = vt.project_factory_id
       JOIN projects p ON p.id = pf.project_id
       JOIN factories f ON f.id = pf.factory_id
      WHERE p.org_id = $1 AND p.created_by = $2 AND ($3::int IS NULL OR p.id = $3)
      ORDER BY vt.created_at DESC LIMIT 500`,
    [u.orgId, u.id, projectId ?? null]);
  res.json(rows.map((r) => ({
    id: r.id,
    url: portalUrl(r.token),
    purpose: r.purpose,
    status: r.used_at ? 'submitted' : new Date(r.expires_at) < new Date() ? 'expired' : 'active',
    expiresAt: r.expires_at, usedAt: r.used_at, createdAt: r.created_at,
    project: { id: r.project_id, name: r.project_name },
    projectFactoryId: r.project_factory_id,
    factoryName: r.factory_name,
  })));
});

vendorLinksRouter.delete('/:linkId', async (req, res) => {
  const { linkId } = parseParams(req, z.object({ linkId: id }));
  const u = currentUser(req);
  const r = await pool.query(
    `DELETE FROM vendor_tokens vt USING project_factories pf, projects p
      WHERE vt.id = $1 AND pf.id = vt.project_factory_id AND p.id = pf.project_id
        AND p.org_id = $2 AND p.created_by = $3`,
    [linkId, u.orgId, u.id]);
  if (!r.rowCount) throw notFound('Link');
  res.status(204).end();
});
