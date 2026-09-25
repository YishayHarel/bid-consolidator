// Projects. Private to their creator within the org (per product decision:
// each account sees only its own projects). All sub-resources hang off
// /projects/:projectId and go through loadProject, which enforces ownership.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { enqueue } from '../../lib/jobs.js';
import { requestObjectDeletion } from '../../lib/storage.js';
import { nullableNumber, nullableText, pagination, parseBody, parseQuery } from '../../lib/validate.js';
import { divisionFormat } from '../../domain/divisions.js';
import { effectiveSettings } from '../../domain/landedCost.js';
import { currentProject, currentUser, loadProject, requireAuth, type ProjectRow } from '../../middleware/auth.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

interface ProjectListRow extends ProjectRow { item_count: number; factory_count: number; submitted_count: number; quote_count: number }

export function projectDTO(p: ProjectRow, org?: { settings: unknown }) {
  const c = p as Partial<ProjectListRow>;
  return {
    id: p.id,
    name: p.name,
    buyer: p.buyer,
    division: p.division,
    status: p.status ?? 'active',
    lastPrice: p.last_price,
    format: divisionFormat(p.division),
    ...(org ? { landedCost: effectiveSettings(org.settings, p.settings) } : {}),
    counts: c.item_count === undefined ? undefined : {
      items: c.item_count, factories: c.factory_count!, submitted: c.submitted_count!, quotes: c.quote_count!,
    },
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

const COUNTS = `
  (SELECT count(*) FROM project_items pi WHERE pi.project_id = p.id AND pi.deleted_at IS NULL)::int AS item_count,
  (SELECT count(*) FROM project_factories pf WHERE pf.project_id = p.id)::int AS factory_count,
  (SELECT count(*) FROM project_factories pf WHERE pf.project_id = p.id AND pf.submitted_at IS NOT NULL)::int AS submitted_count,
  (SELECT count(*) FROM quotes q WHERE q.project_id = p.id)::int AS quote_count`;

projectsRouter.get('/', async (req, res) => {
  const { limit, offset } = parseQuery(req, pagination);
  const u = currentUser(req);
  const [rows, total] = await Promise.all([
    query<ProjectListRow>(pool,
      `SELECT p.*, ${COUNTS} FROM projects p
        WHERE p.org_id = $1 AND p.created_by = $2
        ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
      [u.orgId, u.id, limit, offset]),
    queryOne<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM projects WHERE org_id = $1 AND created_by = $2', [u.orgId, u.id]),
  ]);
  res.json({ items: rows.map((r) => projectDTO(r)), total: total?.n ?? 0, limit, offset });
});

const projectFields = {
  name: z.string().trim().min(1, 'is required').max(255),
  buyer: nullableText(255).optional(),
  division: nullableText(100).optional(),
};

projectsRouter.post('/', async (req, res) => {
  const body = parseBody(req, z.object(projectFields));
  const u = currentUser(req);
  const p = await queryOne<ProjectRow>(pool,
    `INSERT INTO projects (org_id, created_by, name, buyer, division) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [u.orgId, u.id, body.name, body.buyer ?? null, body.division ?? null]);
  res.status(201).json(projectDTO({ ...p!, ...{ item_count: 0, factory_count: 0, submitted_count: 0, quote_count: 0 } } as ProjectListRow));
});

projectsRouter.get('/:projectId', loadProject, async (req, res) => {
  const p = currentProject(req);
  const [withCounts, org] = await Promise.all([
    queryOne<ProjectListRow>(pool, `SELECT p.*, ${COUNTS} FROM projects p WHERE p.id = $1`, [p.id]),
    queryOne<{ settings: unknown }>(pool, 'SELECT settings FROM organizations WHERE id = $1', [p.org_id]),
  ]);
  res.json(projectDTO(withCounts!, org!));
});

projectsRouter.patch('/:projectId', loadProject, async (req, res) => {
  const body = parseBody(req, z.object({
    name: projectFields.name.optional(),
    buyer: projectFields.buyer,
    division: projectFields.division,
    status: z.enum(['active', 'archived', 'awarded']).optional(),
    lastPrice: nullableNumber.optional(),
    landedCost: z.object({
      commissionDivisor: z.number().positive().max(10).optional(),
      freightPerContainer: z.number().min(0).max(1_000_000).optional(),
      defaultEtc: z.number().min(0).max(1000).optional(),
    }).optional(),
  }));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const p = await queryOne<ProjectRow>(pool,
    `UPDATE projects SET
       name       = CASE WHEN $2 THEN $3 ELSE name END,
       buyer      = CASE WHEN $4 THEN $5 ELSE buyer END,
       division   = CASE WHEN $6 THEN $7 ELSE division END,
       status     = COALESCE($8, status),
       last_price = CASE WHEN $9 THEN $10::numeric ELSE last_price END,
       settings   = CASE WHEN $11::jsonb IS NULL THEN settings
                         ELSE jsonb_set(settings, '{landedCost}', COALESCE(settings->'landedCost', '{}'::jsonb) || $11::jsonb) END
     WHERE id = $1 RETURNING *`,
    [currentProject(req).id, has('name'), body.name ?? null, has('buyer'), body.buyer ?? null, has('division'), body.division ?? null,
     body.status ?? null, has('lastPrice'), body.lastPrice ?? null, body.landedCost ? JSON.stringify(body.landedCost) : null]);
  const org = await queryOne<{ settings: unknown }>(pool, 'SELECT settings FROM organizations WHERE id = $1', [p!.org_id]);
  res.json(projectDTO(p!, org!));
});

// Deleting a project removes its rows (cascade) and schedules its files for
// deletion from storage (the purge job does the actual removal).
projectsRouter.delete('/:projectId', loadProject, async (req, res) => {
  const p = currentProject(req);
  const u = currentUser(req);
  await withTx(async (tx) => {
    const keys = await query<{ key: string }>(tx, 'SELECT key FROM stored_objects WHERE project_id = $1', [p.id]);
    await requestObjectDeletion(tx, keys.map((k) => k.key));
    await tx.query('DELETE FROM projects WHERE id = $1', [p.id]);
    await enqueue(tx, { orgId: u.orgId, userId: u.id, projectId: null, type: 'purge-objects', payload: { reason: 'project-deleted', projectId: p.id } });
  });
  res.status(204).end();
});
