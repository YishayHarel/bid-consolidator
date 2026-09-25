require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

// Bootstrap the first admin account for a fresh database. Safe to re-run: it
// never overwrites an existing account's password, and there is no default
// password — INTERNAL_PASSWORD must be set explicitly.
async function seed() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@shalom.com').toLowerCase();
  const pw = process.env.INTERNAL_PASSWORD;
  if (!pw || pw.length < 12) {
    console.error('Seed refused: set INTERNAL_PASSWORD (12+ characters) to bootstrap the admin account.');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const password = await bcrypt.hash(pw, 12);
    const { rowCount } = await client.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [email, password, process.env.SEED_ADMIN_NAME || 'Admin']
    );
    console.log(rowCount ? `Seed complete: created admin ${email}.` : `Seed: ${email} already exists — left unchanged.`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
