const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { parseQuoteExcel } = require('../utils/parseExcel');

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

// List all projects
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, COUNT(q.id)::int AS quote_count
      FROM projects p
      LEFT JOIN quotes q ON q.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create project
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
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update project
router.patch('/:id', requireAuth, async (req, res) => {
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
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get factories invited to a project
router.get('/:id/factories', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pf.*,
              CASE WHEN pf.submitted_at IS NOT NULL THEN 'submitted'
                   WHEN pf.submitted_at IS NULL AND NOW() - pf.invited_at > interval '2 days' THEN 'no_response'
                   ELSE 'pending' END as status
       FROM project_factories pf
       WHERE pf.project_id=$1
       ORDER BY pf.factory_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Invite factories to a project
router.post('/:id/factories', requireAuth, async (req, res) => {
  const { factory_names } = req.body;
  if (!Array.isArray(factory_names) || factory_names.length === 0) {
    return res.status(400).json({ error: 'factory_names must be a non-empty array' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO project_factories (project_id, factory_name)
       VALUES ${factory_names.map((_, i) => `($1,$${i + 2})`).join(',')}
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [req.params.id, ...factory_names]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get quotes for a project
router.get('/:id/quotes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM quotes WHERE project_id=$1 ORDER BY factory_name, style_num',
      [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a quote manually
router.post('/:id/quotes', requireAuth, async (req, res) => {
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

// Upload Excel → parse → insert quotes for a project
router.post('/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { factoryName, quotes } = parseQuoteExcel(req.file.path);
    fs.unlink(req.file.path, () => {});
    if (!quotes.length) return res.status(400).json({ error: 'No quote rows found in file' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const q of quotes) {
        await client.query(
          `INSERT INTO quotes (project_id, factory_name, style_num, description, category, color, scent_fragrance, packaging, moq, price, benchmark_link)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [req.params.id, q.factory_name, q.style_num||null, q.description||null, q.category||null, q.color||null, q.scent_fragrance||null, q.packaging||null, q.moq||null, q.price||null, q.benchmark_link||null]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, factory_name: factoryName, count: quotes.length });
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

// Delete a single quote
router.delete('/quotes/:qid', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM quotes WHERE id=$1', [req.params.qid]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
