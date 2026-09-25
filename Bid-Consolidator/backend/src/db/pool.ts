// PostgreSQL access: one pool for the process, a typed query helper, and a
// transaction helper used by every multi-step write so partial state is never
// committed.
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// NUMERIC (1700) and INT8/BIGINT (20) come back from pg as strings. Prices here
// fit comfortably in a double, and bigint ids/counts stay far below 2^53.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

export function connectionConfig(): pg.PoolConfig {
  if (config.DATABASE_URL) {
    const ca = config.DB_CA_CERT?.replace(/\\n/g, '\n');
    // Explicit opt-out for databases without TLS (CI, local production rehearsals).
    if (/[?&]sslmode=disable\b/.test(config.DATABASE_URL)) return { connectionString: config.DATABASE_URL, ssl: false };
    return {
      connectionString: config.DATABASE_URL,
      // With the Supabase CA certificate the server identity is fully verified;
      // without it the link is still encrypted (Supabase requires TLS).
      ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    };
  }
  return {
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
  };
}

if (config.DATABASE_URL && /[?&]sslmode=disable\b/.test(config.DATABASE_URL)) {
  logger.warn('DB TLS: disabled by sslmode=disable — only use this for local rehearsals, never production');
} else if (config.DATABASE_URL && !config.DB_CA_CERT && !config.isTest) {
  logger.warn('DB TLS: DB_CA_CERT not set — the connection is encrypted but the server certificate is not verified');
}

export const pool = new pg.Pool({
  ...connectionConfig(),
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => logger.error({ err }, 'idle PostgreSQL client error'));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = pg.Pool | PoolClient;

export async function query<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const res = await db.query<T>(text, params);
  return res.rows[0];
}

/** Run `fn` in a transaction. Commits on success, rolls back on any throw. */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
