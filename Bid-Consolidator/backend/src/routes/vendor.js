const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { parseExcel } = require('../utils/parseExcel');
const { organizeFile, organizeByDivisionBuyer } = require('../utils/organizeFile');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only Excel files allowed'), ok);
  },
});

// Internal: list tokens
router.get('/tokens', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vt.*, p.name as project_name, u.name as created_by_name
       FROM vendor_tokens vt
       LEFT JOIN projects p ON p.id = vt.project_id
       LEFT JOIN users u ON u.id = vt.created_by
       ORDER BY vt.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Internal: create token
router.post('/tokens', requireAuth, async (req, res) => {
  const { factory_name, division, buyer } = req.body;
  if (!factory_name) return res.status(400).json({ error: 'factory_name required' });

  const expiresAt = new Date(Date.now() + 30 * 86400000); // 30 days

  try {
    const result = await pool.query(
      `INSERT INTO vendor_tokens (factory_name, division, buyer, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [factory_name, division || null, buyer || null, expiresAt, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Internal: delete token
router.delete('/tokens/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM vendor_tokens WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: validate token
router.get('/validate/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vt.*, p.name as project_name
       FROM vendor_tokens vt
       LEFT JOIN projects p ON p.id = vt.project_id
       WHERE vt.token = $1`,
      [req.params.token]
    );
    const t = result.rows[0];
    if (!t) return res.status(404).json({ status: 'invalid' });
    if (t.used_at) return res.json({ status: 'used', factory_name: t.factory_name });
    if (new Date(t.expires_at) < new Date()) return res.json({ status: 'expired', factory_name: t.factory_name });
    res.json({ status: 'valid', factory_name: t.factory_name, project_name: t.project_name });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: open upload (no token — factory provides their own name)
router.post('/submit-open', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const factory_name = (req.body.factory_name || '').trim();
  if (!factory_name) return res.status(400).json({ error: 'Factory name is required' });

  try {
    const parsed = parseExcel(req.file.path);
    const { folder, destPath } = await organizeFile(req.file.path, parsed, req.file.originalname);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subResult = await client.query(
        `INSERT INTO submissions (factory_name, division, file_name, file_path, file_size, status, notes)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING *`,
        [factory_name, parsed.division, req.file.originalname, destPath, req.file.size, `${parsed.division || 'General'} / ${folder}`]
      );
      const submission = subResult.rows[0];
      for (const p of parsed.products) {
        await client.query(
          `INSERT INTO products (submission_id, factory_name, style_num, factory_style, description, packaging, moq, price, container_units, category, color)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [submission.id, factory_name, p.style_num, p.factory_style, p.description, p.packaging, p.moq, p.price, p.container_units, p.category, p.color]
        );
      }
      await client.query('COMMIT');
      if (req.app.locals.broadcast) req.app.locals.broadcast({ type: 'submission:new', submission });
      res.json({ success: true, factory_name, product_count: parsed.products.length, folder });
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

// Public: token upload
router.post('/submit/:token', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const tokenRes = await pool.query('SELECT * FROM vendor_tokens WHERE token = $1', [req.params.token]);
    const t = tokenRes.rows[0];
    if (!t) return res.status(404).json({ error: 'Invalid token' });
    if (t.used_at) return res.status(400).json({ error: 'Token already used' });
    if (new Date(t.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

    const parsed = parseExcel(req.file.path);
    // Use token's division/buyer for folder — skip AI when we already know
    const division = t.division || parsed.division || 'General';
    const buyer    = t.buyer    || parsed.detectedProject || 'Uncategorized';
    const { destPath } = await organizeByDivisionBuyer(req.file.path, req.file.originalname, division, buyer);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subResult = await client.query(
        `INSERT INTO submissions (factory_name, division, buyer, file_name, file_path, file_size, status, token_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING *`,
        [t.factory_name, division, buyer, req.file.originalname, destPath, req.file.size, t.id, `${division} / ${buyer}`]
      );
      const submission = subResult.rows[0];
      for (const p of parsed.products) {
        await client.query(
          `INSERT INTO products (submission_id, factory_name, style_num, factory_style, description, packaging, moq, price, container_units, category, color)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [submission.id, t.factory_name, p.style_num, p.factory_style, p.description, p.packaging, p.moq, p.price, p.container_units, p.category, p.color]
        );
      }
      await client.query('UPDATE vendor_tokens SET used_at = NOW() WHERE id = $1', [t.id]);
      await client.query('COMMIT');
      if (req.app.locals.broadcast) req.app.locals.broadcast({ type: 'submission:new', submission });
      res.json({ success: true, factory_name: t.factory_name, product_count: parsed.products.length, folder });
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

module.exports = router;
