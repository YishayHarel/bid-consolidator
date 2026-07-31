const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { upsertFactory, normalizeEmails } = require('../utils/factories');

const router = express.Router();

// Shape a DB row for the client: expose both the emails[] array and a joined
// `email` string (so single-email UI keeps working).
function shape(row) {
  const emails = row.emails || [];
  return { id: row.id, name: row.name, emails, email: emails.join(', ') };
}

// List the logged-in user's factory directory
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, emails FROM factories WHERE created_by=$1 ORDER BY name',
      [req.user.id]
    );
    res.json(rows.map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a factory to the user's directory (accepts `emails` array or `email` string)
router.post('/', requireAuth, async (req, res) => {
  const { name, email, emails } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const factory = await upsertFactory(pool, req.user.id, name, emails ?? email);
    res.status(201).json(shape(factory));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a factory's name/emails (only the user's own)
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, email, emails } = req.body;
  const cleanEmails = normalizeEmails(emails ?? email);
  try {
    const { rows } = await pool.query(
      `UPDATE factories
         SET name = COALESCE($1, name),
             emails = $2
       WHERE id=$3 AND created_by=$4
       RETURNING id, name, emails`,
      [name || null, cleanEmails, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Factory not found' });
    res.json(shape(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a factory from the user's directory
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM factories WHERE id=$1 AND created_by=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Factory not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
