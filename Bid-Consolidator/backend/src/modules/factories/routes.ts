// The factory directory: one shared list per organization (every account in the
// org sees the same factories), organized by division. Other organizations
// never see it.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../../db/pool.js';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { emailList, id, labelList, nullableText, parseBody, parseParams, parseQuery } from '../../lib/validate.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';

export const factoriesRouter = Router();
factoriesRouter.use(requireAuth);

export interface FactoryRow {
  id: number; org_id: number; name: string; emails: string[]; contact_name: string | null; divisions: string[];
  created_at: Date; updated_at: Date; project_count?: number;
}
export const factoryDTO = (f: FactoryRow) => ({
  id: f.id, name: f.name, emails: f.emails, contactName: f.contact_name, divisions: f.divisions,
  projectCount: f.project_count ?? 0, createdAt: f.created_at, updatedAt: f.updated_at,
});

factoriesRouter.get('/', async (req, res) => {
  const { division, q } = parseQuery(req, z.object({ division: z.string().max(100).optional(), q: z.string().max(100).optional() }));
  const rows = await query<FactoryRow>(pool,
    `SELECT f.*, (SELECT count(*) FROM project_factories pf WHERE pf.factory_id = f.id)::int AS project_count
       FROM factories f
      WHERE f.org_id = $1
        AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM unnest(f.divisions) d WHERE lower(d) = lower($2)))
        AND ($3::text IS NULL OR f.name ILIKE '%' || $3 || '%' OR f.contact_name ILIKE '%' || $3 || '%')
      ORDER BY lower(f.name)`,
    [currentUser(req).orgId, division ?? null, q ?? null]);
  res.json(rows.map(factoryDTO));
});

const fields = {
  name: z.string().trim().min(1, 'is required').max(255),
  emails: emailList.optional(),
  contactName: nullableText(255).optional(),
  divisions: labelList.optional(),
};

factoriesRouter.post('/', async (req, res) => {
  const body = parseBody(req, z.object(fields));
  const u = currentUser(req);
  try {
    const f = await queryOne<FactoryRow>(pool,
      `INSERT INTO factories (org_id, name, emails, contact_name, divisions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [u.orgId, body.name, body.emails ?? [], body.contactName ?? null, body.divisions ?? [], u.id]);
    res.status(201).json(factoryDTO(f!));
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`"${body.name}" is already in the factory directory.`);
    throw err;
  }
});

factoriesRouter.patch('/:factoryId', async (req, res) => {
  const { factoryId } = parseParams(req, z.object({ factoryId: id }));
  const body = parseBody(req, z.object({ ...fields, name: fields.name.optional() }));
  const has = (k: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, k);
  try {
    const f = await queryOne<FactoryRow>(pool,
      `UPDATE factories SET
         name         = COALESCE($3, name),
         emails       = CASE WHEN $4 THEN $5::text[] ELSE emails END,
         contact_name = CASE WHEN $6 THEN $7 ELSE contact_name END,
         divisions    = CASE WHEN $8 THEN $9::text[] ELSE divisions END
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [factoryId, currentUser(req).orgId, body.name ?? null, has('emails'), body.emails ?? [],
       has('contactName'), body.contactName ?? null, has('divisions'), body.divisions ?? []]);
    if (!f) throw notFound('Factory');
    res.json(factoryDTO(f));
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`Another factory is already named "${body.name}".`);
    throw err;
  }
});

// A factory that's on projects can't be deleted (its quotes would lose their
// owner); remove it from those projects first.
factoriesRouter.delete('/:factoryId', async (req, res) => {
  const { factoryId } = parseParams(req, z.object({ factoryId: id }));
  const u = currentUser(req);
  const used = await queryOne<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM project_factories WHERE factory_id = $1', [factoryId]);
  if (used?.n) throw conflict(`This factory is on ${used.n} project${used.n === 1 ? '' : 's'}. Remove it from ${used.n === 1 ? 'that project' : 'those projects'} first.`);
  const r = await pool.query('DELETE FROM factories WHERE id = $1 AND org_id = $2', [factoryId, u.orgId]);
  if (!r.rowCount) throw notFound('Factory');
  res.status(204).end();
});
