const express = require('express');
const { randomUUID } = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { parseQuoteExcel } = require('../utils/parseExcel');
const { extractImagesByRow } = require('../utils/extractImages');
const { resolveItemIndex } = require('../utils/matchItems');
const { saveObject, contentTypeFor, resolveObject } = require('../utils/storage');

const router = express.Router();

const uploadsRoot = path.join(__dirname, '../../uploads');
const tmpDir = path.join(uploadsRoot, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only Excel files allowed'), ok);
  },
});

// Internal: list tokens — ONLY for projects the logged-in user owns. A token is
// full access to a factory's portal, so it must never leak across accounts.
router.get('/tokens', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT vt.*, p.name AS project_name
      FROM vendor_tokens vt
      JOIN projects p ON p.id = vt.project_id
      WHERE p.created_by = $1
      ORDER BY vt.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Internal: create token — the target project must belong to the user.
router.post('/tokens', requireAuth, async (req, res) => {
  const { factory_name, project_id } = req.body;
  if (!factory_name) return res.status(400).json({ error: 'factory_name required' });
  if (!project_id) return res.status(400).json({ error: 'project_id required' });
  try {
    const own = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND created_by=$2', [project_id, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Project not found' });
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const { rows } = await pool.query(
      `INSERT INTO vendor_tokens (factory_name, project_id, expires_at, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [factory_name, project_id, expiresAt, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Internal: delete token — only if it belongs to one of the user's projects.
router.delete('/tokens/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM vendor_tokens vt USING projects p
       WHERE vt.id=$1 AND vt.project_id=p.id AND p.created_by=$2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Token not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: validate token
router.get('/validate/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vt.*, p.name AS project_name, p.template_path
       FROM vendor_tokens vt
       LEFT JOIN projects p ON p.id = vt.project_id
       WHERE vt.token=$1`,
      [req.params.token]
    );
    const t = rows[0];
    if (!t) return res.status(404).json({ status: 'invalid' });
    if (t.used_at) return res.json({ status: 'used', factory_name: t.factory_name });
    if (new Date(t.expires_at) < new Date()) return res.json({ status: 'expired' });
    res.json({
      status: 'valid',
      factory_name: t.factory_name,
      project_name: t.project_name,
      project_id: t.project_id,
      has_template: !!t.template_path,
      template_name: t.template_path ? path.basename(t.template_path).replace(/^\d+-/, '') : null,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: download the project's outbound template for a valid token. This is
// how factories get the quote file now (instead of an email attachment).
router.get('/template/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.template_path
       FROM vendor_tokens vt
       JOIN projects p ON p.id = vt.project_id
       WHERE vt.token=$1`,
      [req.params.token]
    );
    const templatePath = rows[0]?.template_path;
    if (!templatePath) return res.status(404).json({ error: 'No template available' });
    const downloadName = path.basename(templatePath).replace(/^\d+-/, '');
    const r = await resolveObject(templatePath);
    if (!r) return res.status(404).json({ error: 'File not found' });
    if (r.redirectUrl) return res.redirect(r.redirectUrl);
    return res.download(r.filePath, downloadName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// The tokenless generic portal is disabled: factories may only submit via an
// invite link. The account owner uploads on their behalf from inside the app.
router.get('/open-projects', (req, res) => {
  res.json([]);
});

// ---- Inline quoting dashboard (token-gated, sealed per factory) ------------

// Load a token, returning the row or null. Also checks usable state.
async function loadUsableToken(token) {
  const { rows } = await pool.query(
    `SELECT vt.*, p.name AS project_name, p.division, p.created_by AS owner_id
     FROM vendor_tokens vt JOIN projects p ON p.id = vt.project_id
     WHERE vt.token=$1`,
    [token]
  );
  return rows[0] || null;
}

// GET the project's items plus THIS factory's own saved quotes (never others').
router.get('/items/:token', async (req, res) => {
  try {
    const t = await loadUsableToken(req.params.token);
    if (!t) return res.status(404).json({ status: 'invalid' });
    if (t.used_at) return res.json({ status: 'used', factory_name: t.factory_name });
    if (new Date(t.expires_at) < new Date()) return res.json({ status: 'expired' });

    const { rows: items } = await pool.query(
      `SELECT item_index, style_num, description, moq AS target_moq, inner_pack, master_pack
       FROM project_items WHERE project_id=$1 AND deleted_at IS NULL ORDER BY item_index`,
      [t.project_id]
    );
    const { rows: quotes } = await pool.query(
      `SELECT item_index, price, moq, lead_time FROM quotes WHERE project_id=$1 AND factory_name=$2`,
      [t.project_id, t.factory_name]
    );
    const qByItem = {};
    quotes.forEach(q => { qByItem[q.item_index] = q; });

    res.json({
      status: 'valid',
      factory_name: t.factory_name,
      project_id: t.project_id,
      project_name: t.project_name,
      division: t.division || null,
      items: items.map(it => ({ ...it, quote: qByItem[it.item_index] || null })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Autosave one item's quote (or clear it when the factory un-bids the item).
router.post('/quote-item/:token', async (req, res) => {
  const { item_index, bidding, price, moq, lead_time, style_num, description } = req.body;
  if (item_index == null) return res.status(400).json({ error: 'item_index required' });
  try {
    const t = await loadUsableToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.used_at) return res.status(400).json({ error: 'This quote has already been submitted' });
    if (new Date(t.expires_at) < new Date()) return res.status(400).json({ error: 'This link has expired' });

    await pool.query(
      'DELETE FROM quotes WHERE project_id=$1 AND factory_name=$2 AND item_index=$3',
      [t.project_id, t.factory_name, item_index]
    );
    if (bidding) {
      await pool.query(
        `INSERT INTO quotes (project_id, factory_name, item_index, style_num, description, moq, price, lead_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [t.project_id, t.factory_name, item_index, style_num || null, description || null,
         moq ? parseInt(moq) : null, (price !== '' && price != null) ? price : null, lead_time || null]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Finalize: mark the link used, stamp the factory as submitted, notify the buyer.
router.post('/submit-quotes/:token', async (req, res) => {
  try {
    const t = await loadUsableToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.used_at) return res.status(400).json({ error: 'This quote has already been submitted' });
    if (new Date(t.expires_at) < new Date()) return res.status(400).json({ error: 'This link has expired' });

    await pool.query('UPDATE vendor_tokens SET used_at=NOW() WHERE token=$1', [req.params.token]);
    await pool.query('UPDATE project_factories SET submitted_at=NOW() WHERE project_id=$1 AND factory_name=$2', [t.project_id, t.factory_name]);
    req.app.locals.notifyUser?.(t.owner_id, { type: 'quote:new', factory_name: t.factory_name, project_name: t.project_name });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

// Public: token upload
router.post('/submit/:token', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { rows: tokenRows } = await pool.query('SELECT * FROM vendor_tokens WHERE token=$1', [req.params.token]);
    const t = tokenRows[0];
    if (!t) return res.status(404).json({ error: 'Invalid token' });
    if (t.used_at) return res.status(400).json({ error: 'Token already used' });
    if (new Date(t.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });
    if (!t.project_id) return res.status(400).json({ error: 'Token not linked to a project' });

    const { quotes } = parseQuoteExcel(req.file.path);
    if (!quotes.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'No rows found in file' });
    }

    // Get project name for folder organization
    const { rows: projRows } = await pool.query('SELECT name, created_by FROM projects WHERE id=$1', [t.project_id]);
    if (!projRows.length) throw new Error('Project not found');
    const projectName = projRows[0].name.replace(/[^a-zA-Z0-9-]/g, '_');
    const cleanFactory = t.factory_name.replace(/[^a-zA-Z0-9-]/g, '_');
    const prefix = `projects/${t.project_id}/quotes/${cleanFactory}`;

    // Store the file, extract images (row-aware), align rows to outbound products.
    const ext = path.extname(req.file.originalname);
    const base = path.basename(req.file.originalname, ext);
    await saveObject(`${prefix}/${randomUUID()}-${base.replace(/[^a-zA-Z0-9-]/g, '_')}${ext}`, fs.readFileSync(req.file.path), contentTypeFor(ext));
    const imagesByRow = extractImagesByRow(req.file.path);
    fs.unlink(req.file.path, () => {});
    const { rows: items } = await pool.query(
      'SELECT item_index, style_num, description FROM project_items WHERE project_id=$1',
      [t.project_id]
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM quotes WHERE project_id=$1 AND factory_name=$2', [t.project_id, t.factory_name]);
      for (const q of quotes) {
        const photo = (imagesByRow[q.excel_row] || [])[0];
        let imagePath = null;
        if (photo) {
          imagePath = `${prefix}/images/${randomUUID()}.${photo.ext}`;
          await saveObject(imagePath, photo.data, contentTypeFor(photo.ext));
        }
        const resolved = items.length ? resolveItemIndex(q, items) : q.item_index;
        await client.query(
          `INSERT INTO quotes (project_id, factory_name, item_index, style_num, description, category, color, scent_fragrance, packaging, moq, price, benchmark_link, image_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [t.project_id, t.factory_name, resolved, q.style_num||null, q.description||null, q.category||null, q.color||null, q.scent_fragrance||null, q.packaging||null, q.moq||null, q.price||null, q.benchmark_link||null, imagePath]
        );
      }
      await client.query('UPDATE project_factories SET submitted_at=NOW() WHERE project_id=$1 AND factory_name=$2', [t.project_id, t.factory_name]);
      await client.query('UPDATE vendor_tokens SET used_at=NOW() WHERE id=$1', [t.id]);
      await client.query('COMMIT');
      req.app.locals.notifyUser?.(projRows[0].created_by, { type: 'quote:new', factory_name: t.factory_name, project_name: projRows[0].name });
      res.json({ success: true, factory_name: t.factory_name, count: quotes.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process submission' });
  }
});

// Disabled: factories can only submit via an invite link (token). The account
// owner uploads on their behalf from inside the app.
router.post('/submit-open', (req, res) => {
  return res.status(403).json({ error: 'An invite link is required to submit a quote. Please use the link we emailed you.' });
});

module.exports = router;
