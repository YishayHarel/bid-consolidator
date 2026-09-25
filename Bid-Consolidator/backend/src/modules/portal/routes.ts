// The factory-facing quoting portal. Public (no account), authorized solely by
// the link token, which grants one factory access to one project. A factory
// only ever sees its own quotes and never the internal target price.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTx, type Db } from '../../db/pool.js';
import { badRequest, gone, notFound } from '../../lib/errors.js';
import { fileUrl } from '../../lib/fileUrls.js';
import { portalLimiter } from '../../lib/rateLimits.js';
import { publish } from '../../lib/realtime.js';
import { id, nullableInt, nullableNumber, nullableText, parseBody, parseParams } from '../../lib/validate.js';
import { divisionFormat } from '../../domain/divisions.js';
import { activeItems } from '../items/repo.js';

export const portalRouter = Router();
portalRouter.use(portalLimiter);

interface LinkContext {
  linkId: number; purpose: 'quote' | 'revision'; usedAt: Date | null; expiresAt: Date;
  projectFactoryId: number; projectId: number; projectName: string; division: string | null;
  ownerId: number | null; factoryName: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The single place portal tokens are resolved (was copy-pasted 5× before). */
async function loadLink(db: Db, token: string): Promise<LinkContext | null> {
  if (!UUID.test(token)) return null;
  const r = await queryOne<{
    id: number; purpose: 'quote' | 'revision'; used_at: Date | null; expires_at: Date; pf_id: number;
    project_id: number; project_name: string; division: string | null; owner_id: number | null; factory_name: string;
  }>(db,
    `SELECT vt.id, vt.purpose, vt.used_at, vt.expires_at, pf.id AS pf_id, p.id AS project_id, p.name AS project_name,
            p.division, p.created_by AS owner_id, f.name AS factory_name
       FROM vendor_tokens vt
       JOIN project_factories pf ON pf.id = vt.project_factory_id
       JOIN projects p ON p.id = pf.project_id
       JOIN factories f ON f.id = pf.factory_id
      WHERE vt.token = $1`, [token]);
  if (!r) return null;
  return {
    linkId: r.id, purpose: r.purpose, usedAt: r.used_at, expiresAt: r.expires_at, projectFactoryId: r.pf_id,
    projectId: r.project_id, projectName: r.project_name, division: r.division, ownerId: r.owner_id, factoryName: r.factory_name,
  };
}

async function requireUsable(db: Db, token: string): Promise<LinkContext> {
  const link = await loadLink(db, token);
  if (!link) throw notFound('Quote link');
  if (link.usedAt) throw gone('This quote has already been submitted with this link.');
  if (new Date(link.expiresAt) < new Date()) throw gone('This quote link has expired. Please ask for a new one.');
  return link;
}

const tokenParam = z.object({ token: z.string().max(64) });

portalRouter.get('/:token', async (req, res) => {
  const { token } = parseParams(req, tokenParam);
  const link = await loadLink(pool, token);
  if (!link) return res.status(404).json({ status: 'invalid' });
  if (link.usedAt) return res.json({ status: 'used', factoryName: link.factoryName, projectName: link.projectName });
  if (new Date(link.expiresAt) < new Date()) return res.json({ status: 'expired', factoryName: link.factoryName, projectName: link.projectName });

  const [items, quotes] = await Promise.all([
    activeItems(pool, link.projectId),
    query<{ item_id: number; price: number | null; moq: number | null; lead_time: string | null }>(pool,
      'SELECT item_id, price, moq, lead_time FROM quotes WHERE project_factory_id = $1 AND item_id IS NOT NULL', [link.projectFactoryId]),
  ]);
  const mine = new Map(quotes.map((q) => [q.item_id, q]));
  const format = divisionFormat(link.division);
  res.json({
    status: 'valid',
    purpose: link.purpose,
    factoryName: link.factoryName,
    projectName: link.projectName,
    format,
    expiresAt: link.expiresAt,
    items: items.map((it) => {
      const q = mine.get(it.id);
      return {
        id: it.id,
        position: it.item_index,
        styleNum: it.style_num,
        description: it.description,
        targetMoq: it.moq, // requested MOQ is shared; the target PRICE never is
        ...(format.packCounts ? { innerPack: it.inner_pack, masterPack: it.master_pack } : {}),
        imageUrl: fileUrl(it.images[0]?.key, { ttlSeconds: 24 * 3600 }),
        quote: q ? { price: q.price, moq: q.moq, leadTime: q.lead_time } : null,
      };
    }),
  });
});

// Autosave one item. bidding=false withdraws this factory's quote on the item.
portalRouter.put('/:token/items/:itemId', async (req, res) => {
  const { token, itemId } = parseParams(req, tokenParam.extend({ itemId: id }));
  const body = parseBody(req, z.object({
    bidding: z.boolean(),
    price: nullableNumber.optional(),
    moq: nullableInt.optional(),
    leadTime: nullableText(100).optional(),
  }));
  if (body.price !== undefined && body.price !== null && body.price < 0) throw badRequest('Price cannot be negative.');
  const link = await requireUsable(pool, token);
  const item = await queryOne<{ id: number; style_num: string | null; description: string | null }>(pool,
    'SELECT id, style_num, description FROM project_items WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL', [itemId, link.projectId]);
  if (!item) throw notFound('Item');

  if (!body.bidding) {
    await pool.query('DELETE FROM quotes WHERE item_id = $1 AND project_factory_id = $2', [itemId, link.projectFactoryId]);
    return res.json({ itemId, quote: null });
  }
  // Upsert keeps the owner's notes, winner flag and landed-cost inputs intact.
  const q = await queryOne<{ price: number | null; moq: number | null; lead_time: string | null }>(pool,
    `INSERT INTO quotes (project_id, project_factory_id, item_id, style_num, description, price, moq, lead_time, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (item_id, project_factory_id) WHERE item_id IS NOT NULL DO UPDATE SET
       price = EXCLUDED.price, moq = EXCLUDED.moq, lead_time = EXCLUDED.lead_time, submitted_at = now()
     RETURNING price, moq, lead_time`,
    [link.projectId, link.projectFactoryId, itemId, item.style_num, item.description,
     body.price ?? null, body.moq ?? null, body.leadTime ?? null]);
  res.json({ itemId, quote: { price: q!.price, moq: q!.moq, leadTime: q!.lead_time } });
});

// Finalize: the link is spent and the owner is notified in real time.
portalRouter.post('/:token/submit', async (req, res) => {
  const { token } = parseParams(req, tokenParam);
  const link = await withTx(async (tx) => {
    const l = await requireUsable(tx, token);
    const r = await tx.query('UPDATE vendor_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL', [l.linkId]);
    if (!r.rowCount) throw gone('This quote has already been submitted with this link.');
    await tx.query('UPDATE project_factories SET submitted_at = now() WHERE id = $1', [l.projectFactoryId]);
    return l;
  });
  await publish(link.ownerId, { type: 'quote:new', projectId: link.projectId, projectName: link.projectName, factoryName: link.factoryName });
  res.json({ submitted: true });
});
