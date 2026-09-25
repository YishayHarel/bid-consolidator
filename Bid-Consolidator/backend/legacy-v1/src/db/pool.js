const { Pool } = require('pg');
require('dotenv').config();

// Prefer a single DATABASE_URL (e.g. Supabase) with SSL; fall back to the
// discrete DB_* vars for local development. When DB_CA_CERT (the Supabase CA
// certificate PEM) is set, the server certificate is fully verified; without it
// the connection is still encrypted but not verified (logged as a warning).
const ca = process.env.DB_CA_CERT ? process.env.DB_CA_CERT.replace(/\\n/g, '\n') : null;
if (process.env.DATABASE_URL && !ca) {
  console.warn('DB TLS: DB_CA_CERT not set — connection is encrypted but the server certificate is not verified.');
}
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'bid_consolidator',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
    });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

module.exports = pool;
