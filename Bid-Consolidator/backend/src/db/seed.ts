// Bootstrap the first admin for a FRESH database. Safe to re-run: never
// overwrites an existing account, and there is no default password.
//   INTERNAL_PASSWORD=... SEED_ADMIN_EMAIL=you@company.com npm run seed
import { hashPassword } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { pool, queryOne } from './pool.js';
import { runMigrations } from './migrate.js';

async function seed() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.INTERNAL_PASSWORD ?? '';
  if (!email || password.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and INTERNAL_PASSWORD (12+ characters) to bootstrap the admin account.');
  }
  await runMigrations('up');
  const org = await queryOne<{ id: number }>(pool, 'SELECT min(id) AS id FROM organizations');
  const domain = email.split('@')[1]!;
  await pool.query(
    `UPDATE organizations SET allowed_domains = array(SELECT DISTINCT unnest(allowed_domains || ARRAY[$2]))
      WHERE id = $1`, [org!.id, domain]);
  const row = await queryOne(pool,
    `INSERT INTO users (email, password, name, role, org_id) VALUES ($1, $2, $3, 'admin', $4)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, await hashPassword(password), process.env.SEED_ADMIN_NAME ?? 'Admin', org!.id]);
  logger.info(row ? `created admin ${email}` : `${email} already exists — left unchanged`);
}

seed()
  .then(() => pool.end())
  .catch((err) => { logger.error({ err }, 'seed failed'); process.exit(1); });
