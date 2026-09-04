const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { upsertFactory, normalizeEmails, normalizeList } = require('../utils/factories');

const router = express.Router();

// Shape a DB row for the client: expose both the emails[] array and a joined
// `email` string (so single-email UI keeps working), plus divisions[].
function shape(row) {
  const emails = row.emails || [];
  return {
    id: row.id, name: row.name, emails, email: emails.join(', '),
    contact_name: row.contact_name || '', divisions: row.divisions || [],
  };
}

// List the shared factory directory (universal across all accounts)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, emails, contact_name, divisions FROM factories ORDER BY name'
    );
    res.json(rows.map(shape));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a factory to the user's directory (accepts `emails` array or `email` string)
router.post('/', requireAuth, async (req, res) => {
  const { name, email, emails, contact_name, divisions } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const factory = await upsertFactory(pool, req.user.id, name, emails ?? email, contact_name, divisions);
    res.status(201).json(shape(factory));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a factory's name/emails (shared directory — any account can edit)
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, email, emails, contact_name, divisions } = req.body;
  const cleanEmails = normalizeEmails(emails ?? email);
  const cleanDivisions = normalizeList(divisions);
  try {
    const { rows } = await pool.query(
      `UPDATE factories
         SET name = COALESCE($1, name),
             emails = $2,
             contact_name = NULLIF($4, ''),
             divisions = $5
       WHERE id=$3
       RETURNING id, name, emails, contact_name, divisions`,
      [name || null, cleanEmails, req.params.id, (contact_name || '').trim(), cleanDivisions]
    );
    if (!rows.length) return res.status(404).json({ error: 'Factory not found' });
    res.json(shape(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a factory from the shared directory (any account can remove)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM factories WHERE id=$1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Factory not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
