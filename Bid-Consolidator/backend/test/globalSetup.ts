// Recreate the test database from nothing and apply every migration, exactly
// as a brand-new production database would be built.
import pg from 'pg';
import { testEnv } from '../vitest.config.js';

export default async function setup() {
  Object.assign(process.env, testEnv);
  const admin = new pg.Client({
    host: testEnv.DB_HOST, port: Number(testEnv.DB_PORT), database: 'postgres',
    user: testEnv.DB_USER || undefined, password: testEnv.DB_PASSWORD || undefined,
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${testEnv.DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${testEnv.DB_NAME}`);
  await admin.end();

  const { runMigrations } = await import('../src/db/migrate.js');
  await runMigrations('up');
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
}
