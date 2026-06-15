const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM submissions s WHERE s.project_id = p.id) as submission_count
       FROM projects p
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  const { name, division } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await pool.query(
      `INSERT INTO projects (name, division, status, created_by) VALUES ($1, $2, 'active', $3) RETURNING *`,
      [name, division || 'General', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', async (req, res) => {
  const { name, division, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE projects SET
        name = COALESCE($1, name),
        division = COALESCE($2, division),
        status = COALESCE($3, status),
        updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, division, status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
