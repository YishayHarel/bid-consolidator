const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { parseExcel } = require('../utils/parseExcel');

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

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { project_id, status } = req.query;
  try {
    let q = `
      SELECT s.*, p.name as project_name,
        (SELECT COUNT(*) FROM products WHERE submission_id = s.id) as product_count
      FROM submissions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE 1=1
    `;
    const params = [];
    if (project_id) { params.push(project_id); q += ` AND s.project_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND s.status = $${params.length}`; }
    q += ' ORDER BY s.submitted_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/products', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, lc.commission_pct, lc.base_duty_pct, lc.addl_duty_pct,
              lc.total_fob, lc.units_per_container, lc.sell_price, lc.retail_price, lc.etc_amt
       FROM products pr
       LEFT JOIN landed_costs lc ON lc.product_id = pr.id
       WHERE pr.submission_id = $1
       ORDER BY pr.id`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', async (req, res) => {
  const { status, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE submissions SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        reviewed_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE reviewed_at END,
        reviewed_by = CASE WHEN $1 IN ('approved','rejected') THEN $3 ELSE reviewed_by END
       WHERE id = $4 RETURNING *`,
      [status, notes, req.user.id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/products/:productId/landed-cost', async (req, res) => {
  const { productId } = req.params;
  const { commission_pct, base_duty_pct, addl_duty_pct, total_fob, units_per_container, sell_price, retail_price, etc_amt } = req.body;
  try {
    const prodRes = await pool.query('SELECT submission_id FROM products WHERE id = $1', [productId]);
    if (!prodRes.rows[0]) return res.status(404).json({ error: 'Product not found' });
    const submissionId = prodRes.rows[0].submission_id;

    const result = await pool.query(
      `INSERT INTO landed_costs (product_id, submission_id, commission_pct, base_duty_pct, addl_duty_pct, total_fob, units_per_container, sell_price, retail_price, etc_amt, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (product_id) DO UPDATE SET
         commission_pct = EXCLUDED.commission_pct,
         base_duty_pct = EXCLUDED.base_duty_pct,
         addl_duty_pct = EXCLUDED.addl_duty_pct,
         total_fob = EXCLUDED.total_fob,
         units_per_container = EXCLUDED.units_per_container,
         sell_price = EXCLUDED.sell_price,
         retail_price = EXCLUDED.retail_price,
         etc_amt = EXCLUDED.etc_amt,
         updated_at = NOW()
       RETURNING *`,
      [productId, submissionId, commission_pct ?? 0.12, base_duty_pct ?? 0, addl_duty_pct ?? 0, total_fob, units_per_container, sell_price, retail_price, etc_amt ?? 0.10]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { project_id } = req.body;

  try {
    const parsed = parseExcel(req.file.path);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subResult = await client.query(
        `INSERT INTO submissions (factory_name, project_id, division, file_name, file_path, file_size, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
        [parsed.factoryName || req.file.originalname, project_id || null, parsed.division, req.file.originalname, req.file.path, req.file.size]
      );
      const submission = subResult.rows[0];

      for (const p of parsed.products) {
        await client.query(
          `INSERT INTO products (submission_id, factory_name, style_num, factory_style, description, packaging, moq, price, container_units, category, color)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [submission.id, p.factory_name, p.style_num, p.factory_style, p.description, p.packaging, p.moq, p.price, p.container_units, p.category, p.color]
        );
      }

      await client.query('COMMIT');

      if (req.app.locals.broadcast) {
        req.app.locals.broadcast({ type: 'submission:new', submission });
      }

      res.status(201).json({ submission, productCount: parsed.products.length });
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

router.post('/ai-summary', async (req, res) => {
  const { products, factories } = req.body;
  if (!products?.length) return res.status(400).json({ error: 'No products provided' });

  const styleMap = {};
  for (const p of products) {
    if (!styleMap[p.style_num]) styleMap[p.style_num] = {};
    styleMap[p.style_num][p.factory_name] = p.price;
  }

  const lines = Object.entries(styleMap).map(([style, factPrices]) => {
    const prices = Object.entries(factPrices).map(([f, p]) => `${f}: $${Number(p).toFixed(2)}`).join(', ');
    return `Style ${style}: ${prices}`;
  });

  const prompt = `You are a sourcing analyst. Here is a factory price comparison for a retail buyer:\n\n${lines.join('\n')}\n\nWrite a 3-4 sentence executive summary highlighting the lowest bidder per style, which factories are competitive, and any notable price gaps. Use specific numbers.`;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ summary: message.content[0].text });
  } catch (err) {
    console.error('AI summary error:', err.message);
    res.status(500).json({ error: 'AI summary unavailable' });
  }
});

module.exports = router;
