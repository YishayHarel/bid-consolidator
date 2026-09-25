// The compare sheet, per-quote edits, winner selection, landed cost, and
// uploading a factory's Excel quote on its behalf.
import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { pool, queryOne, withTx } from '../../db/pool.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { enqueue, jobDTO } from '../../lib/jobs.js';
import { extOf, UploadBatch } from '../../lib/storage.js';
import { cleanupUploads, uploadExcel } from '../../lib/uploads.js';
import { id, nullableNumber, nullableText, parseBody, parseParams } from '../../lib/validate.js';
import { divisionFormat } from '../../domain/divisions.js';
import { computeLandedCost, effectiveSettings } from '../../domain/landedCost.js';
import { currentProject, currentUser, loadProject, requireAuth } from '../../middleware/auth.js';
import { activeItems, itemDTO } from '../items/repo.js';
import { mintLink } from '../links/tokens.js';
import { projectQuotes, quoteById, quoteDTO, winnerQuotes } from './repo.js';

export const quotesRouter = Router({ mergeParams: true });
quotesRouter.use(requireAuth, loadProject);

// The whole compare sheet in two queries: every active item with all factories'
// quotes nested under it, plus quote rows the matcher couldn't place.
quotesRouter.get('/compare', async (req, res) => {
  const p = currentProject(req);
  const [items, quotes] = await Promise.all([activeItems(pool, p.id), projectQuotes(pool, p.id)]);
  const byItem = new Map<number, ReturnType<typeof quoteDTO>[]>();
  const unmatched: ReturnType<typeof quoteDTO>[] = [];
  const activeIds = new Set(items.map((i) => i.id));
  for (const q of quotes) {
    const dto = quoteDTO(q);
    if (q.item_id === null) unmatched.push(dto);
    else if (activeIds.has(q.item_id)) (byItem.get(q.item_id) ?? byItem.set(q.item_id, []).get(q.item_id)!).push(dto);
  }
  res.json({
    format: divisionFormat(p.division),
    items: items.map((it) => ({ ...itemDTO(it), quotes: byItem.get(it.id) ?? [] })),
    unmatched,
  });
});

const landedInputs = {
  totalFob: nullableNumber.optional(),
  baseDutyPct: nullableNumber.optional(),
  addlDutyPct: nullableNumber.optional(),
  unitsPerContainer: nullableNumber.optional(),
  sellPrice: nullableNumber.optional(),
  retailPrice: nullableNumber.optional(),
  etcAmount: nullableNumber.optional(),
};

// Partial update: only fields present change. Saving notes can never wipe the
// winner or landed-cost values (the old endpoint rewrote every column).
quotesRouter.patch('/quotes/:quoteId', async (req, res) => {
  const { quoteId } = parseParams(req, z.object({ quoteId: id }));
  const body = parseBody(req, z.object({ notes: nullableText(5000).optional(), itemId: id.optional(), ...landedInputs }));
  const p = currentProject(req);
  const existing = await quoteById(pool, p.id, quoteId);
  if (!existing) throw notFound('Quote');
  if (body.itemId !== undefined) {
    const item = await queryOne(pool, 'SELECT 1 FROM project_items WHERE id = $1 AND project_id = $2', [body.itemId, p.id]);
    if (!item) throw badRequest('That item is not part of this project.');
  }
  const has = (k: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, k);
  const set = (col: string, key: keyof typeof body, cast = '') => [col, has(key), body[key] ?? null, cast] as const;
  const cols = [
    set('comparison_notes', 'notes'),
    set('total_fob', 'totalFob', '::numeric'),
    set('base_duty_pct', 'baseDutyPct', '::numeric'),
    set('addl_duty_pct', 'addlDutyPct', '::numeric'),
    set('units_per_container', 'unitsPerContainer', '::int'),
    set('sell_price', 'sellPrice', '::numeric'),
    set('retail_price', 'retailPrice', '::numeric'),
    set('etc_amt', 'etcAmount', '::numeric'),
    set('item_id', 'itemId', '::int'),
  ];
  const params: unknown[] = [quoteId, p.id];
  const assignments = cols.map(([col, present, value, cast]) => {
    params.push(present, value);
    return `${col} = CASE WHEN $${params.length - 1} THEN $${params.length}${cast} ELSE ${col} END`;
  });
  try {
    await pool.query(`UPDATE quotes SET ${assignments.join(', ')} WHERE id = $1 AND project_id = $2`, params);
  } catch (err) {
    if (isUniqueViolation(err, 'quotes_item_factory_uidx')) throw conflict('This factory already has a quote on that item.');
    throw err;
  }
  res.json(quoteDTO((await quoteById(pool, p.id, quoteId))!));
});

// Pick (or clear, with quoteId: null) the winning quote for an item — one
// atomic operation. The DB guarantees at most one winner per item.
quotesRouter.put('/items/:itemId/winner', async (req, res) => {
  const { itemId } = parseParams(req, z.object({ itemId: id }));
  const { quoteId } = parseBody(req, z.object({ quoteId: z.union([id, z.null()]) }));
  const p = currentProject(req);
  await withTx(async (tx) => {
    const item = await queryOne(tx, 'SELECT id FROM project_items WHERE id = $1 AND project_id = $2 FOR UPDATE', [itemId, p.id]);
    if (!item) throw notFound('Item');
    await tx.query('UPDATE quotes SET is_selected_winner = false WHERE item_id = $1 AND is_selected_winner', [itemId]);
    if (quoteId !== null) {
      const r = await tx.query('UPDATE quotes SET is_selected_winner = true WHERE id = $1 AND item_id = $2', [quoteId, itemId]);
      if (!r.rowCount) throw badRequest('That quote is not for this item.');
    }
  });
  res.json({ itemId, winnerQuoteId: quoteId });
});

quotesRouter.delete('/quotes/:quoteId', async (req, res) => {
  const { quoteId } = parseParams(req, z.object({ quoteId: id }));
  const r = await pool.query('DELETE FROM quotes WHERE id = $1 AND project_id = $2', [quoteId, currentProject(req).id]);
  if (!r.rowCount) throw notFound('Quote');
  res.status(204).end();
});

// Landed cost for each item's winning quote, computed server-side with the
// org/project constants (single source of truth for the formula).
quotesRouter.get('/landed-cost', async (req, res) => {
  const p = currentProject(req);
  const [rows, org] = await Promise.all([
    winnerQuotes(pool, p.id),
    queryOne<{ settings: unknown }>(pool, 'SELECT settings FROM organizations WHERE id = $1', [p.org_id]),
  ]);
  const settings = effectiveSettings(org?.settings, p.settings);
  res.json({
    settings,
    rows: rows.map((q) => {
      const inputs = {
        totalFob: q.total_fob, baseDutyPct: q.base_duty_pct, addlDutyPct: q.addl_duty_pct,
        unitsPerContainer: q.units_per_container, sellPrice: q.sell_price, retailPrice: q.retail_price, etcAmount: q.etc_amt,
      };
      return {
        quoteId: q.id,
        itemId: q.item_id,
        position: q.item_position,
        styleNum: q.item_style_num ?? q.style_num,
        description: q.item_description ?? q.description,
        factory: { id: q.factory_id, name: q.factory_name },
        price: q.price,
        inputs,
        computed: computeLandedCost({ fobPrice: q.price, ...inputs }, settings),
      };
    }),
  });
});

// Upload a factory's quote spreadsheet on its behalf (the owner received it by
// email). Either pick an invited factory or name a new one (invited on the fly).
quotesRouter.post('/quotes/import', uploadExcel, async (req, res) => {
  const p = currentProject(req);
  const u = currentUser(req);
  try {
    if (!req.file) throw badRequest('Attach the factory\'s Excel quote.');
    const body = parseBody(req, z.object({
      projectFactoryId: id.optional(),
      factoryName: z.string().trim().min(1).max(255).optional(),
    }).refine((b) => b.projectFactoryId || b.factoryName, { message: 'Pick which factory this quote is from.' }));
    const batch = new UploadBatch(p.org_id, p.id);
    try {
      const key = await batch.put('sources', await fs.readFile(req.file.path), extOf(req.file.originalname, 'xlsx'));
      const job = await withTx(async (tx) => {
        let pfId = body.projectFactoryId;
        if (pfId) {
          const pf = await queryOne(tx, 'SELECT id FROM project_factories WHERE id = $1 AND project_id = $2', [pfId, p.id]);
          if (!pf) throw badRequest('That factory is not invited to this project.');
        } else {
          const f = await queryOne<{ id: number }>(tx,
            `INSERT INTO factories (org_id, name, divisions, created_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (org_id, lower(name)) DO UPDATE SET name = factories.name RETURNING id`,
            [p.org_id, body.factoryName, p.division ? [p.division] : [], u.id]);
          const pf = await queryOne<{ id: number }>(tx,
            `INSERT INTO project_factories (project_id, factory_id) VALUES ($1, $2)
             ON CONFLICT (project_id, factory_id) DO UPDATE SET project_id = EXCLUDED.project_id RETURNING id`,
            [p.id, f!.id]);
          pfId = pf!.id;
          await mintLink(tx, pfId, 'quote', u.id);
        }
        await batch.record(tx);
        return enqueue(tx, { orgId: u.orgId, userId: u.id, projectId: p.id, type: 'import-quotes',
          payload: { key, projectFactoryId: pfId, fileName: req.file!.originalname } });
      });
      res.status(202).json(jobDTO(job));
    } catch (err) {
      await batch.rollback();
      throw err;
    }
  } finally {
    cleanupUploads(req);
  }
});
