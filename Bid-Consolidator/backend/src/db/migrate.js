require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'internal',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        buyer VARCHAR(255),
        division VARCHAR(100),
        last_price NUMERIC(10,4),
        status VARCHAR(50) DEFAULT 'active',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        factory_name VARCHAR(255) NOT NULL,
        style_num VARCHAR(255),
        description TEXT,
        category VARCHAR(255),
        color VARCHAR(255),
        scent_fragrance VARCHAR(255),
        packaging VARCHAR(255),
        moq INTEGER,
        price NUMERIC(10,4),
        benchmark_link TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_factories (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        factory_name VARCHAR(255) NOT NULL,
        invited_at TIMESTAMPTZ DEFAULT NOW(),
        submitted_at TIMESTAMPTZ,
        UNIQUE(project_id, factory_name)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_tokens (
        id SERIAL PRIMARY KEY,
        token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
        factory_name VARCHAR(255) NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        project_factory_id INTEGER REFERENCES project_factories(id),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
