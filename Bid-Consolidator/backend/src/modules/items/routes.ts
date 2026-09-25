// Items, CAD design files, and the two ways to build the item list:
// "Import Excel" and "Upload CADs" (+ AI detection). Imports and AI run as
// background jobs; the request returns a job id immediately.
import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fileUrl } from '../../lib/fileUrls.js';
import { enqueue, jobDTO } from '../../lib/jobs.js';
import { extOf, requestObjectDeletion, UploadBatch } from '../../lib/storage.js';
import { cleanupUploads, uploadCads, uploadExcel } from '../../lib/uploads.js';
import { id, nullableInt, nullableNumber, nullableText, parseBody, parseParams } from '../../lib/validate.js';
import { currentProject, currentUser, loadProject, requireAuth } from '../../middleware/auth.js';
import { activeItems, createItems, deletedItems, itemById, itemDTO, setPrimaryImage } from './repo.js';

export const itemsRouter = Router({ mergeParams: true });
itemsRouter.use(requireAuth, loadProject);

const itemId = z.object({ itemId: id });
const itemFields = {
  styleNum: nullableText(255).optional(),
  description: nullableText(5000).optional(),
  moq: nullableInt.optional(),
  targetPrice: nullableNumber.optional(),
  innerPack: nullableInt.optional(),
  masterPack: nullableInt.optional(),
  cadId: z.union([id, z.null()]).optional(),
};

async function assertCadInProject(projectId: number, cadId: number | null | undefined) {
  if (cadId == null) return null;
  const cad = await queryOne<{ id: number; file_path: string; content_type: string | null }>(pool,
    'SELECT id, file_path, content_type FROM project_cads WHERE id = $1 AND project_id = $2', [cadId, projectId]);
  if (!cad) throw badRequest('That design file is not part of this project.');
  return cad;
}
const isImage = (ct: string | null) => !!ct && ct.startsWith('image/') && ct !== 'image/vnd.adobe.photoshop';

// ---- Items --------------------------------------------------------------------
itemsRouter.get('/items', async (req, res) => {
  res.json((await activeItems(pool, currentProject(req).id)).map(itemDTO));
});

itemsRouter.get('/items/deleted', async (req, res) => {
  res.json((await deletedItems(pool, currentProject(req).id)).map(itemDTO));
});

itemsRouter.post('/items', async (req, res) => {
  const body = parseBody(req, z.object(itemFields));
  if (!body.styleNum && !body.description && !body.cadId) throw badRequest('Give the item a name, specs, or a design file.');
  const p = currentProject(req);
  const cad = await assertCadInProject(p.id, body.cadId);
  const [newId] = await withTx((tx) =>
    createItems(tx, p.id, [{ ...body, imageKeys: cad && isImage(cad.content_type) ? [cad.file_path] : [] }]));
  res.status(201).json(itemDTO((await itemById(pool, p.id, newId!))!));
});

itemsRouter.patch('/items/:itemId', async (req, res) => {
  const { itemId: iid } = parseParams(req, itemId);
  const body = parseBody(req, z.object(itemFields));
  const p = currentProject(req);
  const existing = await itemById(pool, p.id, iid);
  if (!existing) throw notFound('Item');
  const has = (k: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, k);
  const cad = has('cadId') ? await assertCadInProject(p.id, body.cadId) : undefined;
  await withTx(async (tx) => {
    await tx.query(
      `UPDATE project_items SET
         style_num   = CASE WHEN $3  THEN $4  ELSE style_num   END,
         description = CASE WHEN $5  THEN $6  ELSE description END,
         moq         = CASE WHEN $7  THEN $8::int ELSE moq     END,
         last_price  = CASE WHEN $9  THEN $10::numeric ELSE last_price END,
         inner_pack  = CASE WHEN $11 THEN $12::int ELSE inner_pack END,
         master_pack = CASE WHEN $13 THEN $14::int ELSE master_pack END,
         cad_id      = CASE WHEN $15 THEN $16::int ELSE cad_id END
       WHERE id = $1 AND project_id = $2`,
      [iid, p.id,
       has('styleNum'), body.styleNum ?? null, has('description'), body.description ?? null,
       has('moq'), body.moq ?? null, has('targetPrice'), body.targetPrice ?? null,
       has('innerPack'), body.innerPack ?? null, has('masterPack'), body.masterPack ?? null,
       has('cadId'), body.cadId ?? null]);
    // Linking a CAD makes it the item's reference image (when it's an image).
    if (cad !== undefined) await setPrimaryImage(tx, p.id, iid, cad && isImage(cad.content_type) ? cad.file_path : null);
  });
  res.json(itemDTO((await itemById(pool, p.id, iid))!));
});

// Soft delete: recoverable. Quotes and images are kept for restore.
itemsRouter.delete('/items/:itemId', async (req, res) => {
  const { itemId: iid } = parseParams(req, itemId);
  const r = await pool.query('UPDATE project_items SET deleted_at = now() WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL',
    [iid, currentProject(req).id]);
  if (!r.rowCount) throw notFound('Item');
  res.status(204).end();
});

itemsRouter.post('/items/:itemId/restore', async (req, res) => {
  const { itemId: iid } = parseParams(req, itemId);
  const p = currentProject(req);
  const r = await pool.query('UPDATE project_items SET deleted_at = NULL WHERE id = $1 AND project_id = $2', [iid, p.id]);
  if (!r.rowCount) throw notFound('Item');
  res.json(itemDTO((await itemById(pool, p.id, iid))!));
});

// ---- Import from a structured Excel sheet (background job) --------------------
itemsRouter.post('/items/import-excel', uploadExcel, async (req, res) => {
  const p = currentProject(req);
  const u = currentUser(req);
  if (!req.file) throw badRequest('Attach an Excel file.');
  const batch = new UploadBatch(p.org_id, p.id);
  try {
    const key = await batch.put('sources', await fs.readFile(req.file.path), extOf(req.file.originalname, 'xlsx'));
    const job = await withTx(async (tx) => {
      await batch.record(tx);
      return enqueue(tx, { orgId: u.orgId, userId: u.id, projectId: p.id, type: 'import-excel', payload: { key, fileName: req.file!.originalname } });
    });
    res.status(202).json(jobDTO(job));
  } catch (err) {
    await batch.rollback();
    throw err;
  } finally {
    cleanupUploads(req);
  }
});

// ---- CAD design files ----------------------------------------------------------
const cadDTO = (c: { id: number; original_name: string | null; content_type: string | null; file_path: string; created_at: Date }) => ({
  id: c.id, name: c.original_name, contentType: c.content_type, createdAt: c.created_at,
  url: fileUrl(c.file_path, { downloadName: c.original_name ?? undefined }),
});

itemsRouter.get('/cads', async (req, res) => {
  const rows = await query(pool, 'SELECT * FROM project_cads WHERE project_id = $1 ORDER BY id', [currentProject(req).id]);
  res.json(rows.map((r) => cadDTO(r as Parameters<typeof cadDTO>[0])));
});

// Upload CADs. With AI configured, a detection job splits them into items
// (several products per sheet); without it, each file becomes one item now.
itemsRouter.post('/cads', uploadCads, async (req, res) => {
  const p = currentProject(req);
  const u = currentUser(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Attach at least one design file.');
  const batch = new UploadBatch(p.org_id, p.id);
  try {
    const stored: { key: string; name: string; type: string }[] = [];
    for (const f of files) {
      const ext = extOf(f.originalname);
      stored.push({ key: await batch.put('cads', await fs.readFile(f.path), ext, f.mimetype || undefined), name: f.originalname, type: f.mimetype });
    }
    const result = await withTx(async (tx) => {
      await batch.record(tx);
      const cads: { id: number; key: string; name: string; type: string }[] = [];
      for (const s of stored) {
        const row = await queryOne<{ id: number }>(tx,
          `INSERT INTO project_cads (project_id, file_path, original_name, content_type) VALUES ($1, $2, $3, $4) RETURNING id`,
          [p.id, s.key, s.name, s.type]);
        cads.push({ id: row!.id, ...s });
      }
      if (config.aiEnabled) {
        const job = await enqueue(tx, { orgId: u.orgId, userId: u.id, projectId: p.id, type: 'detect-items', payload: { cadIds: cads.map((c) => c.id) } });
        return { cads, job: jobDTO(job), createdItems: 0 };
      }
      const ids = await createItems(tx, p.id, cads.map((c) => ({
        styleNum: c.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || null,
        cadId: c.id,
        imageKeys: isImage(c.type) ? [c.key] : [],
      })));
      return { cads, job: null, createdItems: ids.length };
    });
    res.status(result.job ? 202 : 201).json({ cadIds: result.cads.map((c) => c.id), job: result.job, createdItems: result.createdItems, ai: config.aiEnabled });
  } catch (err) {
    await batch.rollback();
    throw err;
  } finally {
    cleanupUploads(req);
  }
});

itemsRouter.delete('/cads/:cadId', async (req, res) => {
  const { cadId } = parseParams(req, z.object({ cadId: id }));
  const p = currentProject(req);
  await withTx(async (tx) => {
    const cad = await queryOne<{ file_path: string }>(tx, 'DELETE FROM project_cads WHERE id = $1 AND project_id = $2 RETURNING file_path', [cadId, p.id]);
    if (!cad) throw notFound('Design file');
    // Items keep their cropped image; only images that ARE the raw CAD go.
    const stillUsed = await queryOne(tx, 'SELECT 1 FROM project_item_images WHERE image_path = $1 LIMIT 1', [cad.file_path]);
    if (!stillUsed) await requestObjectDeletion(tx, [cad.file_path]);
  });
  res.status(204).end();
});

// Re-run AI detection over CADs that don't have items yet.
itemsRouter.post('/detect-items', async (req, res) => {
  if (!config.aiEnabled) throw badRequest('AI CAD reading is not configured on the server.');
  const p = currentProject(req);
  const u = currentUser(req);
  const pending = await query<{ id: number }>(pool,
    `SELECT c.id FROM project_cads c
      WHERE c.project_id = $1 AND NOT EXISTS (SELECT 1 FROM project_items pi WHERE pi.cad_id = c.id)`, [p.id]);
  if (!pending.length) throw badRequest('Every design file already has items. Upload new CADs to detect more.');
  const job = await enqueue(pool, { orgId: u.orgId, userId: u.id, projectId: p.id, type: 'detect-items', payload: { cadIds: pending.map((c) => c.id) } });
  res.status(202).json(jobDTO(job));
});
