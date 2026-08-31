const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { parseQuoteExcel } = require('../utils/parseExcel');
const { extractImagesByRow } = require('../utils/extractImages');
const { upsertFactory } = require('../utils/factories');
const { resolveItemIndex } = require('../utils/matchItems');
const { saveObject, resolveObject, getObjectBuffer, removePrefix, contentTypeFor } = require('../utils/storage');
const { aiEnabled, renderPdfToPages, detectProducts, cropBox, imageToPng } = require('../utils/cadVision');

const uploadsRoot = path.join(__dirname, '../../uploads');

const router = express.Router();

const tmpDir = path.join(__dirname, '../../uploads/tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only Excel files allowed'), ok);
  },
});

// CAD / design files that seed a project's items. Accept the formats design
// teams actually export (images, PDF, common vector/raster design files).
const CAD_TYPES = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg|pdf|ai|eps|psd)$/i;
const cadUpload = multer({
  dest: tmpDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (CAD_TYPES.test(file.originalname)) return cb(null, true);
    cb(new Error(`"${file.originalname}" isn't a supported design file (use PNG, JPG, PDF, TIFF, SVG, AI/EPS/PSD).`));
  },
});
// Wrap multer so type/size errors return clear JSON instead of a generic 500.
function cadUploadMw(req, res, next) {
  cadUpload.array('files', 100)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A file is over the 50MB limit.' : (err.message || 'Upload rejected');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// Ownership guard for any authenticated /:id route: the project must exist AND
// belong to the logged-in user. Returns 404 (not 403) so we don't leak that a
// project id exists for someone else. Runs after requireAuth (needs req.user).
async function ownProject(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT created_by FROM projects WHERE id=$1', [req.params.id]);
    if (!rows.length || rows[0].created_by !== req.user.id) {
      return res.status(404).json({ error: 'Project not found' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// List all projects with factory status
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
             COUNT(DISTINCT q.id)::int AS quote_count,
             COUNT(DISTINCT pf.id)::int AS factory_count,
             COUNT(DISTINCT CASE WHEN pf.submitted_at IS NOT NULL THEN pf.id END)::int AS submitted_count
      FROM projects p
      LEFT JOIN quotes q ON q.project_id = p.id
      LEFT JOIN project_factories pf ON pf.project_id = p.id
      WHERE p.created_by = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create project. Projects are now built from CAD design files + items (see the
// CAD builder endpoints below), so no outbound Excel is parsed here.
router.post('/', requireAuth, async (req, res) => {
  const { name, buyer, division, last_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO projects (name, buyer, division, last_price, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, buyer || null, division || null, last_price || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- CAD-driven project builder --------------------------------------------

// Upload one or more CAD/design files (images or PDF). Each file also becomes an
// item automatically (named from the filename), so a whole batch of designs turns
// into an item list in one shot. Add extra items manually if a CAD needs several.
router.post('/:id/cads', requireAuth, ownProject, cadUploadMw, async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  try {
    const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id=$1', [req.params.id]);
    const cleanName = (proj[0]?.name || 'project').replace(/[^a-zA-Z0-9-]/g, '_');
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(item_index),-1)+1 AS next FROM project_items WHERE project_id=$1', [req.params.id]);
    let itemIndex = mx[0].next;

    const cads = [];
    const items = [];
    for (const f of req.files) {
      const ext = path.extname(f.originalname);
      const key = `${cleanName}/cads/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      await saveObject(key, fs.readFileSync(f.path), contentTypeFor(ext));
      fs.unlink(f.path, () => {});
      const { rows: cadRows } = await pool.query(
        `INSERT INTO project_cads (project_id, file_path, original_name, content_type)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, key, f.originalname, contentTypeFor(ext)]
      );
      const cad = cadRows[0];
      cads.push(cad);

      // When AI is available, items are created by the detect-items pass (which
      // can split several products out of one CAD). Without AI, fall back to one
      // item per file, named from the filename.
      if (!aiEnabled()) {
        const itemName = path.basename(f.originalname, ext).replace(/[_]+/g, ' ').trim();
        const { rows: itemRows } = await pool.query(
          `INSERT INTO project_items (project_id, item_index, style_num, cad_id, image_path)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.params.id, itemIndex, itemName || `Item ${itemIndex + 1}`, cad.id, key]
        );
        await pool.query(
          `INSERT INTO project_item_images (project_id, item_index, position, image_path)
           VALUES ($1,$2,0,$3) ON CONFLICT (project_id, item_index, position) DO UPDATE SET image_path=EXCLUDED.image_path`,
          [req.params.id, itemIndex, key]
        );
        items.push(itemRows[0]);
        itemIndex++;
      }
    }
    res.status(201).json({ cads, items, ai: aiEnabled() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload CADs' });
  }
});

// List a project's CAD files.
router.get('/:id/cads', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, original_name, content_type, created_at FROM project_cads WHERE project_id=$1 ORDER BY id',
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Delete a CAD (items referencing it keep their mirrored image; cad_id is nulled).
router.delete('/:id/cads/:cadId', requireAuth, ownProject, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_cads WHERE id=$1 AND project_id=$2', [req.params.cadId, req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Serve a CAD file (public — consumed via <img>/<embed> which can't send auth).
router.get('/:id/cad/:cadId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT file_path FROM project_cads WHERE id=$1 AND project_id=$2',
      [req.params.cadId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return serveStored(res, rows[0].file_path);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// List a project's items (for the builder), with their linked CAD.
router.get('/:id/items', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pi.item_index, pi.style_num, pi.description, pi.moq, pi.last_price, pi.cad_id,
              pi.inner_pack, pi.master_pack,
              c.original_name AS cad_name, c.content_type AS cad_type
       FROM project_items pi
       LEFT JOIN project_cads c ON c.id = pi.cad_id
       WHERE pi.project_id=$1 AND pi.deleted_at IS NULL
       ORDER BY pi.item_index`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Mirror a CAD image into the item's reference-image slot so Compare/portal show it.
async function mirrorCadImage(projectId, itemIndex, cadId) {
  await pool.query('DELETE FROM project_item_images WHERE project_id=$1 AND item_index=$2', [projectId, itemIndex]);
  if (!cadId) { await pool.query('UPDATE project_items SET image_path=NULL WHERE project_id=$1 AND item_index=$2', [projectId, itemIndex]); return; }
  const { rows } = await pool.query('SELECT file_path FROM project_cads WHERE id=$1 AND project_id=$2', [cadId, projectId]);
  const key = rows[0]?.file_path || null;
  await pool.query('UPDATE project_items SET image_path=$1 WHERE project_id=$2 AND item_index=$3', [key, projectId, itemIndex]);
  if (key) {
    await pool.query(
      `INSERT INTO project_item_images (project_id, item_index, position, image_path)
       VALUES ($1,$2,0,$3) ON CONFLICT (project_id, item_index, position) DO UPDATE SET image_path=EXCLUDED.image_path`,
      [projectId, itemIndex, key]
    );
  }
}

// Create an item on a project (name, specs, target price, MOQ, linked CAD).
router.post('/:id/items', requireAuth, ownProject, async (req, res) => {
  const { style_num, description, moq, last_price, cad_id } = req.body;
  try {
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(item_index),-1)+1 AS next FROM project_items WHERE project_id=$1', [req.params.id]);
    const itemIndex = mx[0].next;
    const { rows } = await pool.query(
      `INSERT INTO project_items (project_id, item_index, style_num, description, moq, last_price, cad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, itemIndex, style_num || null, description || null,
       moq ? parseInt(moq) : null, (last_price !== '' && last_price != null) ? last_price : null, cad_id || null]
    );
    await mirrorCadImage(req.params.id, itemIndex, cad_id || null);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// Soft-delete an item (recoverable). Keeps its images/quotes so it can be restored.
router.delete('/:id/items/:itemIndex', requireAuth, ownProject, async (req, res) => {
  try {
    await pool.query('UPDATE project_items SET deleted_at=NOW() WHERE project_id=$1 AND item_index=$2', [req.params.id, req.params.itemIndex]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// List soft-deleted items (for the restore panel).
router.get('/:id/items/deleted', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT item_index, style_num, description FROM project_items WHERE project_id=$1 AND deleted_at IS NOT NULL ORDER BY item_index',
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Restore a soft-deleted item.
router.post('/:id/items/:itemIndex/restore', requireAuth, ownProject, async (req, res) => {
  try {
    await pool.query('UPDATE project_items SET deleted_at=NULL WHERE project_id=$1 AND item_index=$2', [req.params.id, req.params.itemIndex]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Update project
router.patch('/:id', requireAuth, ownProject, async (req, res) => {
  const { name, buyer, division, last_price, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE projects
       SET name=COALESCE($1,name), buyer=COALESCE($2,buyer), division=COALESCE($3,division),
           last_price=COALESCE($4::numeric,last_price), status=COALESCE($5,status)
       WHERE id=$6 RETURNING *`,
      [name||null, buyer||null, division||null, last_price!=null?last_price:null, status||null, req.params.id]
    );
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete project
router.delete('/:id', requireAuth, ownProject, async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get factories invited to a project
router.get('/:id/factories', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows: totalRows } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM project_items WHERE project_id=$1',
      [req.params.id]
    );
    const totalItems = totalRows[0].total;

    const { rows } = await pool.query(
      `SELECT pf.*,
              COALESCE(f.name, pf.factory_name) AS display_name,
              array_to_string(f.emails, ', ') AS email,
              f.contact_name,
              COUNT(DISTINCT q.item_index)::int AS items_received,
              CASE WHEN pf.submitted_at IS NOT NULL THEN 'submitted'
                   WHEN pf.submitted_at IS NULL AND NOW() - pf.invited_at > interval '2 days' THEN 'no_response'
                   ELSE 'pending' END as status
       FROM project_factories pf
       LEFT JOIN factories f ON f.id = pf.factory_id
       LEFT JOIN quotes q ON q.project_id = pf.project_id AND q.factory_name = pf.factory_name AND q.item_index IS NOT NULL
       WHERE pf.project_id=$1
       GROUP BY pf.id, f.name, f.emails, f.contact_name
       ORDER BY pf.factory_name`,
      [req.params.id]
    );
    res.json(rows.map(r => ({ ...r, total_items: totalItems })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Invite factories to a project + auto-generate tokens
// body: { factories: [{ factory_id?: number, name: string, email?: string }] }
router.post('/:id/factories', requireAuth, ownProject, async (req, res) => {
  const { factories: toInvite } = req.body;
  if (!Array.isArray(toInvite) || toInvite.length === 0) {
    return res.status(400).json({ error: 'factories must be a non-empty array' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = [];
      for (const entry of toInvite) {
        let factory;
        if (entry.factory_id) {
          const { rows } = await client.query('SELECT * FROM factories WHERE id=$1 AND created_by=$2', [entry.factory_id, req.user.id]);
          factory = rows[0];
          if (!factory) continue;
        } else {
          if (!entry.name || !entry.name.trim()) continue;
          factory = await upsertFactory(client, req.user.id, entry.name, entry.emails ?? entry.email, entry.contact_name, entry.divisions);
        }

        const { rows: pfRows } = await client.query(
          `INSERT INTO project_factories (project_id, factory_name, factory_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, factory_name) DO NOTHING
           RETURNING id, factory_name`,
          [req.params.id, factory.name, factory.id]
        );
        if (pfRows.length) inserted.push(pfRows[0]);
      }

      // Auto-generate tokens for each newly-invited factory
      const expiresAt = new Date(Date.now() + 30 * 86400000);
      for (const f of inserted) {
        await client.query(
          `INSERT INTO vendor_tokens (factory_name, project_id, project_factory_id, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [f.factory_name, req.params.id, f.id, expiresAt, req.user.id]
        );
      }

      await client.query('COMMIT');
      res.json(inserted);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a factory from a project
router.delete('/:id/factories/:fid', requireAuth, ownProject, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_factories WHERE id=$1 AND project_id=$2', [req.params.fid, req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Import items from a structured Excel sheet (the classic outbound format):
// one item per row, with Style #, description/specs, MOQ, and embedded photos.
// Appends to whatever items the project already has (CAD-built or not).
router.post('/:id/items-from-excel', requireAuth, ownProject, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id=$1', [req.params.id]);
    const cleanName = (proj[0]?.name || 'project').replace(/[^a-zA-Z0-9-]/g, '_');
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(item_index),-1)+1 AS next FROM project_items WHERE project_id=$1', [req.params.id]);
    const base = mx[0].next;

    const { quotes: items } = parseQuoteExcel(req.file.path);
    const imagesByRow = extractImagesByRow(req.file.path);
    const created = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const itemIndex = base + i;
      const photos = imagesByRow[it.excel_row] || [];
      const keys = [];
      for (let p = 0; p < photos.length; p++) {
        const key = `${cleanName}/excel/images/item${itemIndex}-${p}.${photos[p].ext}`;
        await saveObject(key, photos[p].data, contentTypeFor(photos[p].ext));
        keys.push(key);
      }
      const { rows: itRows } = await pool.query(
        `INSERT INTO project_items (project_id, item_index, style_num, description, moq, image_path)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, itemIndex, it.style_num || null, it.description || null, it.moq || null, keys[0] || null]
      );
      for (let p = 0; p < keys.length; p++) {
        await pool.query(
          `INSERT INTO project_item_images (project_id, item_index, position, image_path)
           VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, item_index, position) DO NOTHING`,
          [req.params.id, itemIndex, p, keys[p]]
        );
      }
      created.push(itRows[0]);
    }
    fs.unlink(req.file.path, () => {});
    res.status(201).json({ created: created.length, items: created });
  } catch (err) {
    console.error(err);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Failed to import Excel' });
  }
});

// AI: scan the project's not-yet-processed CADs, detect each product on each
// page, and create one item per product (cropped to that product). Idempotent —
// only processes CADs that don't have items yet. Returns what it created.
router.post('/:id/detect-items', requireAuth, ownProject, async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured (set GEMINI_API_KEY on the server).' });
  try {
    const { rows: cads } = await pool.query(
      `SELECT * FROM project_cads
       WHERE project_id=$1
         AND id NOT IN (SELECT DISTINCT cad_id FROM project_items WHERE project_id=$1 AND cad_id IS NOT NULL)
       ORDER BY id`,
      [req.params.id]
    );
    if (!cads.length) return res.json({ created: 0, items: [], message: 'No new CADs to scan.' });

    const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id=$1', [req.params.id]);
    const cleanName = (proj[0]?.name || 'project').replace(/[^a-zA-Z0-9-]/g, '_');
    const { rows: mx } = await pool.query('SELECT COALESCE(MAX(item_index),-1)+1 AS next FROM project_items WHERE project_id=$1', [req.params.id]);
    let itemIndex = mx[0].next;

    const created = [];
    for (const cad of cads) {
      let bytes;
      try { bytes = await getObjectBuffer(cad.file_path); } catch { continue; }
      const isPdf = (cad.content_type || '').includes('pdf') || /\.pdf$/i.test(cad.original_name || '');
      let pages = [];
      try { pages = isPdf ? await renderPdfToPages(bytes) : [await imageToPng(bytes)]; }
      catch (e) { console.error('CAD render failed:', e.message); }

      for (const pageBuf of pages) {
        let products = [];
        try { products = await detectProducts(pageBuf); } catch (e) { console.error('detect failed:', e.message); }
        if (!products.length) products = [{ name: '', box: null }]; // fallback: whole page = 1 item

        for (const prod of products) {
          let cropBuf = pageBuf;
          if (prod.box) { try { cropBuf = await cropBox(pageBuf, prod.box); } catch { cropBuf = pageBuf; } }
          const key = `${cleanName}/cads/crops/i${itemIndex}-${Date.now()}-${Math.round(Math.random() * 1e5)}.png`;
          await saveObject(key, cropBuf, 'image/png');
          const fallbackName = (cad.original_name || 'Item').replace(/\.[^.]+$/, '');
          const name = prod.name || `${fallbackName} ${itemIndex + 1}`;
          const { rows: itRows } = await pool.query(
            `INSERT INTO project_items (project_id, item_index, style_num, description, cad_id, image_path)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.id, itemIndex, name, prod.specs || null, cad.id, key]
          );
          await pool.query(
            `INSERT INTO project_item_images (project_id, item_index, position, image_path)
             VALUES ($1,$2,0,$3) ON CONFLICT (project_id, item_index, position) DO UPDATE SET image_path=EXCLUDED.image_path`,
            [req.params.id, itemIndex, key]
          );
          created.push(itRows[0]);
          itemIndex++;
        }
      }
    }
    res.json({ created: created.length, items: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI detection failed' });
  }
});

// Get quotes for a project (with the outbound item's description/style joined in)
router.get('/:id/quotes', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.*, pi.description AS item_description, pi.style_num AS item_style_num
       FROM quotes q
       LEFT JOIN project_items pi ON pi.project_id = q.project_id AND pi.item_index = q.item_index
       WHERE q.project_id=$1 ORDER BY q.factory_name, q.style_num`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update an item's fields. Only fields present in the body change, so it serves
// both the Compare tab (last_price only) and the CAD builder (name/specs/moq/cad).
router.patch('/:id/items/:itemIndex', requireAuth, ownProject, async (req, res) => {
  const b = req.body;
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  try {
    await pool.query(
      `INSERT INTO project_items (project_id, item_index) VALUES ($1,$2)
       ON CONFLICT (project_id, item_index) DO NOTHING`,
      [req.params.id, req.params.itemIndex]
    );
    const numOrNull = (v) => (v !== '' && v != null) ? parseInt(v) : null;
    const { rows } = await pool.query(
      `UPDATE project_items SET
         style_num   = CASE WHEN $3  THEN $4  ELSE style_num   END,
         description = CASE WHEN $5  THEN $6  ELSE description  END,
         moq         = CASE WHEN $7  THEN $8  ELSE moq         END,
         last_price  = CASE WHEN $9  THEN $10 ELSE last_price  END,
         cad_id      = CASE WHEN $11 THEN $12 ELSE cad_id      END,
         inner_pack  = CASE WHEN $13 THEN $14 ELSE inner_pack  END,
         master_pack = CASE WHEN $15 THEN $16 ELSE master_pack END
       WHERE project_id=$1 AND item_index=$2 RETURNING *`,
      [req.params.id, req.params.itemIndex,
       has('style_num'), b.style_num ?? null,
       has('description'), b.description ?? null,
       has('moq'), has('moq') ? numOrNull(b.moq) : null,
       has('last_price'), (b.last_price !== '' && b.last_price != null) ? b.last_price : null,
       has('cad_id'), b.cad_id ?? null,
       has('inner_pack'), has('inner_pack') ? numOrNull(b.inner_pack) : null,
       has('master_pack'), has('master_pack') ? numOrNull(b.master_pack) : null]
    );
    if (has('cad_id')) await mirrorCadImage(req.params.id, req.params.itemIndex, b.cad_id || null);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get comparison data for a specific item (all factories' quotes for one product)
router.get('/:id/comparison/:itemIndex', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM quotes WHERE project_id=$1 AND item_index=$2 ORDER BY factory_name`,
      [req.params.id, req.params.itemIndex]
    );
    if (!rows.length) return res.status(404).json({ error: 'No quotes found for this item' });
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all items for a project (for comparison tabs) — unions the outbound
// template's items with whatever any factory has quoted, keyed by item_index
// since Style # is often blank in real files.
router.get('/:id/styles', requireAuth, ownProject, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(pi.item_index, q.item_index) AS item_index,
              COALESCE(pi.style_num, q.style_num) AS style_num,
              COALESCE(pi.description, q.description) AS description,
              pi.last_price,
              pi.moq,
              pi.inner_pack,
              pi.master_pack,
              COALESCE(img.image_count, 0)::int AS image_count
       FROM (SELECT item_index, style_num, description, last_price, moq, inner_pack, master_pack FROM project_items WHERE project_id=$1 AND deleted_at IS NULL) pi
       FULL OUTER JOIN
            (SELECT DISTINCT ON (item_index) item_index, style_num, description
             FROM quotes WHERE project_id=$1 AND item_index IS NOT NULL
               AND item_index NOT IN (SELECT item_index FROM project_items WHERE project_id=$1 AND deleted_at IS NOT NULL)
             ORDER BY item_index, submitted_at) q
       ON pi.item_index = q.item_index
       LEFT JOIN
            (SELECT item_index, COUNT(*) AS image_count FROM project_item_images WHERE project_id=$1 GROUP BY item_index) img
       ON img.item_index = pi.item_index
       ORDER BY item_index`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a quote manually
router.post('/:id/quotes', requireAuth, ownProject, async (req, res) => {
  const { factory_name, style_num, description, category, color, scent_fragrance, packaging, moq, price, benchmark_link } = req.body;
  if (!factory_name) return res.status(400).json({ error: 'factory_name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO quotes (project_id, factory_name, style_num, description, category, color, scent_fragrance, packaging, moq, price, benchmark_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.id, factory_name, style_num||null, description||null, category||null, color||null, scent_fragrance||null, packaging||null, moq||null, price||null, benchmark_link||null]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload Excel → parse → insert quotes for a project, assigned to a factory
// that Jack picks (so the Compare sheet knows whose quote it is). Extracts the
// factory's photos and replaces any prior submission from that same factory.
router.post('/:id/upload', requireAuth, ownProject, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const factoryName = (req.body.factory_name || '').trim();
  if (!factoryName) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Factory required — pick which factory this quote is from' });
  }
  try {
    const { quotes } = parseQuoteExcel(req.file.path);
    if (!quotes.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'No quote rows found in file' });
    }

    const { rows: projRows } = await pool.query('SELECT name FROM projects WHERE id=$1', [req.params.id]);
    if (!projRows.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Project not found' });
    }

    // Store file + row images in object storage under <Project>/<Factory>/.
    const projectName = projRows[0].name.replace(/[^a-zA-Z0-9-]/g, '_');
    const cleanFactory = factoryName.replace(/[^a-zA-Z0-9-]/g, '_');
    const prefix = `${projectName}/${cleanFactory}`;
    const ext = path.extname(req.file.originalname);
    const base = path.basename(req.file.originalname, ext);
    await saveObject(`${prefix}/${Date.now()}-${base}${ext}`, fs.readFileSync(req.file.path), contentTypeFor(ext));
    const imagesByRow = extractImagesByRow(req.file.path);
    fs.unlink(req.file.path, () => {});

    // Align each quoted row to the correct outbound product (Style # then
    // combined-description similarity) rather than by row position.
    const { rows: items } = await pool.query(
      'SELECT item_index, style_num, description FROM project_items WHERE project_id=$1',
      [req.params.id]
    );

    const client = await pool.connect();
    let matched = 0, unmatched = 0;
    try {
      await client.query('BEGIN');
      // Replace any prior submission from this factory so re-uploads don't duplicate.
      await client.query('DELETE FROM quotes WHERE project_id=$1 AND factory_name=$2', [req.params.id, factoryName]);
      for (const q of quotes) {
        const photo = (imagesByRow[q.excel_row] || [])[0];
        let imagePath = null;
        if (photo) {
          imagePath = `${prefix}/images/${q.excel_row}-0.${photo.ext}`;
          await saveObject(imagePath, photo.data, contentTypeFor(photo.ext));
        }
        // Use the matched outbound product's index; fall back to the row's own
        // position only when the project has no outbound template to match against.
        const resolved = items.length ? resolveItemIndex(q, items) : q.item_index;
        if (items.length) { resolved != null ? matched++ : unmatched++; }
        await client.query(
          `INSERT INTO quotes (project_id, factory_name, item_index, style_num, description, category, color, scent_fragrance, packaging, moq, price, benchmark_link, image_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [req.params.id, factoryName, resolved, q.style_num||null, q.description||null, q.category||null, q.color||null, q.scent_fragrance||null, q.packaging||null, q.moq||null, q.price||null, q.benchmark_link||null, imagePath]
        );
      }
      await client.query('UPDATE project_factories SET submitted_at=NOW() WHERE project_id=$1 AND factory_name=$2', [req.params.id, factoryName]);
      await client.query('COMMIT');
      res.json({ success: true, factory_name: factoryName, count: quotes.length, matched, unmatched });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Update quote (landed cost data + comparison data)
router.patch('/:id/quotes/:qid', requireAuth, ownProject, async (req, res) => {
  const { total_fob, base_duty_pct, addl_duty_pct, units_per_container, sell_price, retail_price, etc_amt, comparison_notes, is_selected_winner } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE quotes
       SET total_fob=$1, base_duty_pct=$2, addl_duty_pct=$3, units_per_container=$4, sell_price=$5, retail_price=$6, etc_amt=$7, comparison_notes=$8, is_selected_winner=$9
       WHERE id=$10 AND project_id=$11
       RETURNING *`,
      [total_fob||null, base_duty_pct||0, addl_duty_pct||0, units_per_container||null, sell_price||null, retail_price||null, etc_amt||0.10, comparison_notes||null, is_selected_winner||false, req.params.qid, req.params.id]
    );
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve a stored image: redirect to a signed Supabase URL, or stream the local
// file in dev. No requireAuth — consumed via <img src>, which can't send the
// bearer token.
async function serveStored(res, stored) {
  const r = await resolveObject(stored);
  if (!r) return res.status(404).json({ error: 'Image not found' });
  if (r.redirectUrl) return res.redirect(r.redirectUrl);
  return res.sendFile(r.filePath);
}

// Get image for a quote
router.get('/:id/quote-image/:qid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT image_path FROM quotes WHERE id=$1 AND project_id=$2',
      [req.params.qid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Image not found' });
    return serveStored(res, rows[0].image_path);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve the Nth reference photo (0-based position) for an outbound item.
router.get('/:id/item-image/:itemIndex/:position', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT image_path FROM project_item_images WHERE project_id=$1 AND item_index=$2 AND position=$3',
      [req.params.id, req.params.itemIndex, req.params.position]
    );
    if (!rows.length) return res.status(404).json({ error: 'Image not found' });
    return serveStored(res, rows[0].image_path);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Back-compat: single reference image for an item (position 0).
router.get('/:id/item-image/:itemIndex', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT image_path FROM project_item_images WHERE project_id=$1 AND item_index=$2 AND position=0',
      [req.params.id, req.params.itemIndex]
    );
    if (!rows.length) return res.status(404).json({ error: 'Image not found' });
    return serveStored(res, rows[0].image_path);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a single quote
router.delete('/quotes/:qid', requireAuth, async (req, res) => {
  try {
    // Only allow deleting quotes that belong to one of the user's own projects.
    const { rowCount } = await pool.query(
      `DELETE FROM quotes q
       USING projects p
       WHERE q.id=$1 AND q.project_id=p.id AND p.created_by=$2`,
      [req.params.qid, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Quote not found' });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
