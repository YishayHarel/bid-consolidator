const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Brute-force protection: cap login/register attempts per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Sign-up is restricted to company email domains (comma-separated env override).
const ALLOWED_SIGNUP_DOMAINS = (process.env.ALLOWED_SIGNUP_DOMAINS || 'shalomint.com,shalom.com')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// Fetch an organization's branding, or null. Never throws.
async function getOrg(orgId) {
  if (!orgId) return null;
  try {
    const { rows } = await pool.query(
      'SELECT id, name, logo_mark, logo_title, logo_sub, brand_color FROM organizations WHERE id=$1',
      [orgId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });

    const org = await getOrg(user.org_id);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, org_id: user.org_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, org_id: user.org_id }, org });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanName = (name || '').trim();

  if (!cleanEmail || !password || !cleanName) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  const domain = cleanEmail.split('@')[1];
  if (!ALLOWED_SIGNUP_DOMAINS.includes(domain)) {
    return res.status(403).json({ error: 'Sign-up is limited to company email addresses.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });

    const hash = await bcrypt.hash(password, 10);
    // New accounts join the default (lowest-id) organization for branding.
    const orgRes = await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
    const orgId = orgRes.rows[0]?.id || null;

    const result = await pool.query(
      `INSERT INTO users (email, password, name, role, org_id)
       VALUES ($1, $2, $3, 'internal', $4)
       RETURNING id, email, name, role, org_id`,
      [cleanEmail, hash, cleanName, orgId]
    );
    const user = result.rows[0];
    const org = await getOrg(user.org_id);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, org_id: user.org_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.status(201).json({ token, user, org });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, role, org_id FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    const org = await getOrg(result.rows[0].org_id);
    res.json({ ...result.rows[0], org });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
