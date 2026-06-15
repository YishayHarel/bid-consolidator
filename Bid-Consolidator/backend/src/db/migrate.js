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
        division VARCHAR(100),
        status VARCHAR(50) DEFAULT 'active',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_tokens (
        id SERIAL PRIMARY KEY,
        token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
        factory_name VARCHAR(255) NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        factory_name VARCHAR(255) NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        division VARCHAR(100),
        file_name VARCHAR(500),
        file_path VARCHAR(500),
        file_size INTEGER,
        status VARCHAR(50) DEFAULT 'pending',
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by INTEGER REFERENCES users(id),
        notes TEXT,
        token_id INTEGER REFERENCES vendor_tokens(id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
        factory_name VARCHAR(255),
        style_num VARCHAR(255),
        factory_style VARCHAR(255),
        description TEXT,
        packaging VARCHAR(255),
        moq INTEGER,
        price NUMERIC(10,4),
        container_units INTEGER,
        category VARCHAR(255),
        color VARCHAR(255),
        factory_photo VARCHAR(500),
        internal_photo VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS landed_costs (
        id SERIAL PRIMARY KEY,
        product_id INTEGER UNIQUE REFERENCES products(id) ON DELETE CASCADE,
        submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
        commission_pct NUMERIC(6,4) DEFAULT 0.12,
        base_duty_pct NUMERIC(6,4) DEFAULT 0,
        addl_duty_pct NUMERIC(6,4) DEFAULT 0,
        total_fob NUMERIC(10,4),
        units_per_container INTEGER,
        sell_price NUMERIC(10,4),
        retail_price NUMERIC(10,4),
        etc_amt NUMERIC(10,4) DEFAULT 0.10,
        updated_at TIMESTAMPTZ DEFAULT NOW()
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
