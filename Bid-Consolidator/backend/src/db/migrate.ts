// Versioned schema migrations (node-pg-migrate, plain .sql files in
// /migrations). Applied migrations are recorded in `pgmigrations`; an advisory
// lock makes concurrent runs (e.g. two instances booting) safe; each migration
// runs in its own transaction. Runs on server start unless MIGRATE_ON_START=false.
//
// CLI:  npm run migrate          apply all pending
//       npm run migrate:down     roll back the most recent one
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { connectionConfig } from './pool.js';
import { logger } from '../lib/logger.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(direction: 'up' | 'down' = 'up', count?: number) {
  const applied = await runner({
    databaseUrl: connectionConfig(),
    dir: MIGRATIONS_DIR,
    migrationsTable: 'pgmigrations',
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    checkOrder: true,
    singleTransaction: false, // each migration gets its own transaction
    verbose: false,
    log: (msg: string) => logger.info({ migration: true }, msg),
  });
  if (applied.length) logger.info({ migrations: applied.map((m) => m.name) }, `migrations ${direction}: ${applied.length} applied`);
  else logger.info('migrations: schema is up to date');
  return applied;
}

// Run directly: `tsx src/db/migrate.ts up|down`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  runMigrations(direction)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      process.exit(1);
    });
}
