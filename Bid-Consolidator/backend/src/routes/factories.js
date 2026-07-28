const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { upsertFactory } = require('../utils/factories');

const router = express.Router();

// List all factories in the global directory
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email FROM factories ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a factory to the global directory
router.post('/', requireAuth, async (req, res) => {
  const { name, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const factory = await upsertFactory(pool, name, email);
    res.status(201).json(factory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a factory's name/email
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, email } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE factories SET name=COALESCE($1,name), email=COALESCE(NULLIF($2,''),email) WHERE id=$3 RETURNING id, name, email`,
      [name || null, email || '', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Factory not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a factory from the global directory
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM factories WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
