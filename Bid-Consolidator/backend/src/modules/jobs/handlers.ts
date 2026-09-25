// Background job handlers. Each one: reads its input file from storage, does
// the slow work (parsing, image extraction, AI), uploads any new files FIRST,
// then commits all rows in ONE transaction (recording the new files in the same
// transaction). On failure the uploaded files are deleted again, so a failed
// job leaves no half-built state. Handlers are idempotent: the result is saved
// inside the committing transaction, and a retry after a crash returns it
// instead of importing twice.
import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';
import { registerJob, type JobContext } from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { publish } from '../../lib/realtime.js';
import { requestObjectDeletion, storage, UploadBatch } from '../../lib/storage.js';
import { cropBox, detectProducts, imageToPng, renderPdfToPages } from '../../domain/cadVision.js';
import { extractImagesByRow } from '../../domain/excel/extractImages.js';
import { parseQuoteExcel } from '../../domain/excel/parseQuoteExcel.js';
import { matchItem } from '../../domain/matching.js';
import { activeItems, createItems, type NewItem } from '../items/repo.js';

async function saveResult(tx: PoolClient, jobId: number, result: unknown) {
  await tx.query('UPDATE jobs SET result = $2 WHERE id = $1', [jobId, JSON.stringify(result)]);
}
const priorResult = (ctx: JobContext) => (ctx.job.result != null ? ctx.job.result : undefined);

// ---- Import items from a structured Excel sheet -------------------------------
registerJob('import-excel', async (payload, ctx) => {
  const done = priorResult(ctx);
  if (done !== undefined) return done;
  const projectId = ctx.job.project_id!;
  await ctx.progress(5, 'Reading the spreadsheet');
  const buf = await storage.get(String(payload.key));
  const { rows } = parseQuoteExcel(buf);
  if (!rows.length) throw badRequest('No product rows found. Make sure the sheet has a header row (Style #, Description, MOQ, Price) with one product per row.');
  const images = extractImagesByRow(buf);

  const batch = new UploadBatch(ctx.job.org_id, projectId);
  try {
    const items: NewItem[] = [];
    for (const [i, r] of rows.entries()) {
      const keys: string[] = [];
      for (const ph of images[r.excelRow] ?? []) keys.push(await batch.put('item-images', ph.data, ph.ext));
      items.push({ styleNum: r.styleNum || null, description: r.description || null, moq: r.moq, targetPrice: r.price, imageKeys: keys });
      if (i % 5 === 0) await ctx.progress(10 + (i / rows.length) * 80, `Saving product photos (${i + 1} of ${rows.length})`);
    }
    await ctx.progress(92, 'Adding items to the sheet');
    return await withTx(async (tx) => {
      await batch.record(tx);
      const ids = await createItems(tx, projectId, items);
      const result = { created: ids.length, photos: batch.keys.length };
      await saveResult(tx, ctx.job.id, result);
      return result;
    });
  } catch (err) {
    await batch.rollback();
    throw err;
  }
});

// ---- AI: split CAD files into items --------------------------------------------
registerJob('detect-items', async (payload, ctx) => {
  const projectId = ctx.job.project_id!;
  const cadIds = (Array.isArray(payload.cadIds) ? payload.cadIds : []).map(Number).filter(Number.isInteger);
  // Idempotent per CAD: only CADs that don't have items yet (a retry resumes).
  const cads = await query<{ id: number; file_path: string; original_name: string | null; content_type: string | null }>(pool,
    `SELECT c.id, c.file_path, c.original_name, c.content_type FROM project_cads c
      WHERE c.project_id = $1 AND c.id = ANY($2)
        AND NOT EXISTS (SELECT 1 FROM project_items pi WHERE pi.cad_id = c.id)
      ORDER BY c.id`, [projectId, cadIds]);
  let created = 0;
  for (const [ci, cad] of cads.entries()) {
    const name = cad.original_name ?? 'Design';
    const base = name.replace(/\.[^.]+$/, '');
    const bytes = await storage.get(cad.file_path);
    const isPdf = (cad.content_type ?? '').includes('pdf') || /\.pdf$/i.test(name);
    let pages: Buffer[] = [];
    try { pages = isPdf ? await renderPdfToPages(bytes) : [await imageToPng(bytes)]; }
    catch (err) { logger.warn({ err, cadId: cad.id }, 'could not render CAD for AI — adding it as a single item'); }

    const batch = new UploadBatch(ctx.job.org_id, projectId);
    try {
      const items: NewItem[] = [];
      if (!pages.length) {
        // Formats we can't rasterize (e.g. .ai/.psd/.eps): one item, no crop.
        items.push({ styleNum: base, cadId: cad.id });
      }
      for (const [pi, page] of pages.entries()) {
        await ctx.progress(((ci + pi / pages.length) / cads.length) * 95, `Reading ${name}${pages.length > 1 ? ` — page ${pi + 1} of ${pages.length}` : ''}`);
        // A failed AI call throws: the job retries later rather than silently
        // inventing wrong items. An empty answer means "one product per page".
        let products = await detectProducts(page);
        if (!products.length) products = [{ name: '', specs: '', box: null }];
        for (const prod of products) {
          let crop = page;
          if (prod.box) { try { crop = await cropBox(page, prod.box); } catch { crop = page; } }
          const key = await batch.put('crops', crop, 'png', 'image/png');
          items.push({
            styleNum: prod.name || `${base}${pages.length > 1 ? ` p${pi + 1}` : ''}`,
            description: prod.specs || null,
            cadId: cad.id,
            imageKeys: [key],
          });
        }
      }
      const ids = await withTx(async (tx) => { await batch.record(tx); return createItems(tx, projectId, items); });
      created += ids.length;
    } catch (err) {
      await batch.rollback();
      throw err;
    }
  }
  return { created, cads: cads.length };
});

// ---- A factory's Excel quote, uploaded by the owner on its behalf --------------
registerJob('import-quotes', async (payload, ctx) => {
  const done = priorResult(ctx);
  if (done !== undefined) return done;
  const projectId = ctx.job.project_id!;
  const pfId = Number(payload.projectFactoryId);
  const pf = await queryOne<{ id: number; name: string; owner_id: number | null; project_name: string }>(pool,
    `SELECT pf.id, f.name, p.created_by AS owner_id, p.name AS project_name
       FROM project_factories pf JOIN factories f ON f.id = pf.factory_id JOIN projects p ON p.id = pf.project_id
      WHERE pf.id = $1 AND pf.project_id = $2`, [pfId, projectId]);
  if (!pf) throw badRequest('That factory is no longer on this project.');

  await ctx.progress(5, 'Reading the quote');
  const buf = await storage.get(String(payload.key));
  const { rows } = parseQuoteExcel(buf);
  if (!rows.length) throw badRequest('No quote rows found. Make sure the sheet has a header row (Style #, Description, MOQ, Price).');
  const images = extractImagesByRow(buf);

  const batch = new UploadBatch(ctx.job.org_id, projectId);
  try {
    const rowImage: (string | null)[] = [];
    for (const [i, r] of rows.entries()) {
      const ph = images[r.excelRow]?.[0];
      rowImage.push(ph ? await batch.put('quote-images', ph.data, ph.ext) : null);
      if (i % 5 === 0) await ctx.progress(10 + (i / rows.length) * 60, `Saving product photos (${i + 1} of ${rows.length})`);
    }
    await ctx.progress(80, 'Matching rows to items');
    const result = await withTx(async (tx) => {
      await batch.record(tx);
      let items = (await activeItems(tx, projectId)).map((i) => ({ id: i.id, styleNum: i.style_num, description: i.description }));
      let seeded = 0;
      if (!items.length) {
        // No item list yet: the first factory's sheet defines the products.
        const ids = await createItems(tx, projectId, rows.map((r) => ({ styleNum: r.styleNum || null, description: r.description || null, moq: r.moq })));
        items = ids.map((id, i) => ({ id, styleNum: rows[i]!.styleNum, description: rows[i]!.description }));
        seeded = ids.length;
      }
      const toDelete: string[] = [];
      // This upload replaces the factory's previous unplaced rows.
      const prevUnmatched = await query<{ image_path: string | null }>(tx,
        'DELETE FROM quotes WHERE project_factory_id = $1 AND item_id IS NULL RETURNING image_path', [pfId]);
      toDelete.push(...prevUnmatched.map((r) => r.image_path).filter((k): k is string => !!k));

      const placed = new Set<number>();
      let matched = 0;
      let unmatched = 0;
      for (const [i, r] of rows.entries()) {
        const itemId = seeded ? items[i]!.id : matchItem(r, items);
        const values = [projectId, pfId, r.styleNum || null, r.description || null, r.category || null, r.color || null,
          r.scentFragrance || null, r.packaging || null, r.moq, r.price, r.benchmarkLink || null, rowImage[i] ?? null];
        if (itemId !== null && !placed.has(itemId)) {
          placed.add(itemId);
          matched++;
          // Upsert: refresh the quoted values; keep the owner's notes, winner
          // flag and landed-cost inputs. Capture the replaced photo for cleanup.
          const r2 = await queryOne<{ old_image: string | null }>(tx,
            `WITH old AS (SELECT image_path FROM quotes WHERE item_id = $13 AND project_factory_id = $2)
             INSERT INTO quotes (project_id, project_factory_id, style_num, description, category, color, scent_fragrance,
                                 packaging, moq, price, benchmark_link, image_path, item_id, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
             ON CONFLICT (item_id, project_factory_id) WHERE item_id IS NOT NULL DO UPDATE SET
               style_num = EXCLUDED.style_num, description = EXCLUDED.description, category = EXCLUDED.category,
               color = EXCLUDED.color, scent_fragrance = EXCLUDED.scent_fragrance, packaging = EXCLUDED.packaging,
               moq = EXCLUDED.moq, price = EXCLUDED.price, benchmark_link = EXCLUDED.benchmark_link,
               image_path = COALESCE(EXCLUDED.image_path, quotes.image_path), submitted_at = now()
             RETURNING (SELECT image_path FROM old) AS old_image`,
            [...values, itemId]);
          if (r2?.old_image && rowImage[i] && r2.old_image !== rowImage[i]) toDelete.push(r2.old_image);
        } else {
          // Couldn't be placed confidently (or a second row for the same item):
          // kept as unmatched for the owner to assign on the Compare sheet.
          unmatched++;
          await tx.query(
            `INSERT INTO quotes (project_id, project_factory_id, style_num, description, category, color, scent_fragrance,
                                 packaging, moq, price, benchmark_link, image_path, item_id, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, now())`, values);
        }
      }
      // Items this factory quoted before but left out of this file: withdrawn.
      const withdrawn = await query<{ image_path: string | null }>(tx,
        `DELETE FROM quotes WHERE project_factory_id = $1 AND item_id IS NOT NULL AND NOT (item_id = ANY($2::int[]))
         RETURNING image_path`, [pfId, [...placed]]);
      toDelete.push(...withdrawn.map((r) => r.image_path).filter((k): k is string => !!k));
      await requestObjectDeletion(tx, toDelete);
      await tx.query('UPDATE project_factories SET submitted_at = now() WHERE id = $1', [pfId]);
      const res = { factory: pf.name, rows: rows.length, matched, unmatched, seededItems: seeded, withdrawn: withdrawn.length };
      await saveResult(tx, ctx.job.id, res);
      return res;
    });
    await publish(pf.owner_id, { type: 'quote:new', projectId, projectName: pf.project_name, factoryName: pf.name });
    return result;
  } catch (err) {
    await batch.rollback();
    throw err;
  }
});

// ---- Delete files whose owners (projects, CADs, replaced photos) are gone ------
registerJob('purge-objects', async () => {
  let purged = 0;
  for (;;) {
    const rows = await query<{ key: string }>(pool,
      `SELECT key FROM stored_objects WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL
        ORDER BY delete_requested_at LIMIT 500`);
    if (!rows.length) break;
    const keys = rows.map((r) => r.key);
    await storage.remove(keys);
    await pool.query('DELETE FROM stored_objects WHERE key = ANY($1)', [keys]);
    purged += keys.length;
  }
  return { purged };
});
