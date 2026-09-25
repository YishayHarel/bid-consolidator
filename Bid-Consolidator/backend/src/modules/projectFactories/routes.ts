// Factories invited to a project, their response status, and their portal links.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { emailList, id, nullableText, parseBody, parseParams } from '../../lib/validate.js';
import { currentProject, currentUser, loadProject, requireAuth } from '../../middleware/auth.js';
import { mintLink, portalUrl } from '../links/tokens.js';

export const projectFactoriesRouter = Router({ mergeParams: true });
projectFactoriesRouter.use(requireAuth, loadProject);

interface InvitedRow {
  id: number; factory_id: number; name: string; emails: string[]; contact_name: string | null;
  invited_at: Date; submitted_at: Date | null; items_received: number; last_emailed_at: Date | null;
  link_token: string | null; link_expires_at: Date | null;
}

async function listInvited(projectId: number) {
  const [rows, total] = await Promise.all([
    query<InvitedRow>(pool,
      `SELECT pf.id, pf.factory_id, f.name, f.emails, f.contact_name, pf.invited_at, pf.submitted_at,
              (SELECT count(*) FROM quotes q JOIN project_items pi ON pi.id = q.item_id
                WHERE q.project_factory_id = pf.id AND pi.deleted_at IS NULL)::int AS items_received,
              (SELECT max(sent_at) FROM email_log e WHERE e.project_factory_id = pf.id) AS last_emailed_at,
              lk.token AS link_token, lk.expires_at AS link_expires_at
         FROM project_factories pf
         JOIN factories f ON f.id = pf.factory_id
         LEFT JOIN LATERAL (SELECT token, expires_at FROM vendor_tokens vt
                             WHERE vt.project_factory_id = pf.id AND vt.used_at IS NULL AND vt.expires_at > now()
                             ORDER BY vt.created_at DESC LIMIT 1) lk ON true
        WHERE pf.project_id = $1 ORDER BY lower(f.name)`, [projectId]),
    queryOne<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM project_items WHERE project_id = $1 AND deleted_at IS NULL', [projectId]),
  ]);
  return rows.map((r) => {
    const status = r.submitted_at ? 'submitted'
      : Date.now() - new Date(r.invited_at).getTime() > 2 * 86_400_000 ? 'no_response' : 'pending';
    return {
      id: r.id,
      factory: { id: r.factory_id, name: r.name, emails: r.emails, contactName: r.contact_name },
      status, invitedAt: r.invited_at, submittedAt: r.submitted_at, lastEmailedAt: r.last_emailed_at,
      itemsReceived: r.items_received, totalItems: total?.n ?? 0,
      portalUrl: r.link_token ? portalUrl(r.link_token) : null,
      linkExpiresAt: r.link_expires_at,
    };
  });
}

projectFactoriesRouter.get('/factories', async (req, res) => {
  res.json(await listInvited(currentProject(req).id));
});

// Invite directory factories and/or brand-new ones (added to the directory,
// tagged with this project's division). Each invitation gets a portal link.
projectFactoriesRouter.post('/factories', async (req, res) => {
  const body = parseBody(req, z.object({
    factoryIds: z.array(id).max(100).default([]),
    newFactories: z.array(z.object({
      name: z.string().trim().min(1).max(255),
      emails: emailList.optional(),
      contactName: nullableText(255).optional(),
    })).max(50).default([]),
  }));
  if (!body.factoryIds.length && !body.newFactories.length) throw badRequest('Pick at least one factory to invite.');
  const p = currentProject(req);
  const u = currentUser(req);
  const invited = await withTx(async (tx) => {
    const ids = new Set<number>();
    for (const fid of body.factoryIds) {
      const f = await queryOne<{ id: number }>(tx, 'SELECT id FROM factories WHERE id = $1 AND org_id = $2', [fid, p.org_id]);
      if (!f) throw badRequest('One of the selected factories is not in your directory.');
      ids.add(f.id);
    }
    for (const nf of body.newFactories) {
      const f = await queryOne<{ id: number }>(tx,
        `INSERT INTO factories (org_id, name, emails, contact_name, divisions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, lower(name)) DO UPDATE SET
           emails = CASE WHEN cardinality(EXCLUDED.emails) > 0 THEN EXCLUDED.emails ELSE factories.emails END,
           contact_name = COALESCE(EXCLUDED.contact_name, factories.contact_name),
           divisions = (SELECT array_agg(DISTINCT d) FROM unnest(factories.divisions || EXCLUDED.divisions) d)
         RETURNING id`,
        [p.org_id, nf.name, nf.emails ?? [], nf.contactName ?? null, p.division ? [p.division] : [], u.id]);
      ids.add(f!.id);
    }
    const created: number[] = [];
    for (const fid of ids) {
      const pf = await queryOne<{ id: number }>(tx,
        `INSERT INTO project_factories (project_id, factory_id) VALUES ($1, $2)
         ON CONFLICT (project_id, factory_id) DO NOTHING RETURNING id`, [p.id, fid]);
      if (pf) { created.push(pf.id); await mintLink(tx, pf.id, 'quote', u.id); }
    }
    return created.length;
  });
  res.status(201).json({ invited, factories: await listInvited(p.id) });
});

// Removing a factory from a project also removes its quotes and links.
projectFactoriesRouter.delete('/factories/:projectFactoryId', async (req, res) => {
  const { projectFactoryId } = parseParams(req, z.object({ projectFactoryId: id }));
  const r = await pool.query('DELETE FROM project_factories WHERE id = $1 AND project_id = $2', [projectFactoryId, currentProject(req).id]);
  if (!r.rowCount) throw notFound('Invited factory');
  res.status(204).end();
});

// Issue a fresh portal link (e.g. the old one expired or was already used),
// revoking any other unused quote links for this factory.
projectFactoriesRouter.post('/factories/:projectFactoryId/link', async (req, res) => {
  const { projectFactoryId } = parseParams(req, z.object({ projectFactoryId: id }));
  const p = currentProject(req);
  const link = await withTx(async (tx) => {
    const pf = await queryOne(tx, 'SELECT id FROM project_factories WHERE id = $1 AND project_id = $2', [projectFactoryId, p.id]);
    if (!pf) throw notFound('Invited factory');
    await tx.query(`DELETE FROM vendor_tokens WHERE project_factory_id = $1 AND used_at IS NULL AND purpose = 'quote'`, [projectFactoryId]);
    return mintLink(tx, projectFactoryId, 'quote', currentUser(req).id);
  });
  res.status(201).json({ portalUrl: portalUrl(link.token), expiresAt: link.expires_at });
});
