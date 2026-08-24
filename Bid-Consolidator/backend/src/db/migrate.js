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
        total_fob NUMERIC(10,4),
        base_duty_pct NUMERIC(10,4),
        addl_duty_pct NUMERIC(10,4),
        units_per_container INTEGER,
        sell_price NUMERIC(10,4),
        retail_price NUMERIC(10,4),
        etc_amt NUMERIC(10,4) DEFAULT 0.10,
        image_path VARCHAR(512),
        comparison_notes TEXT,
        is_selected_winner BOOLEAN DEFAULT false,
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS factories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS factories_name_lower_idx ON factories (LOWER(name));
    `);

    await client.query(`
      ALTER TABLE project_factories ADD COLUMN IF NOT EXISTS factory_id INTEGER REFERENCES factories(id) ON DELETE SET NULL;
    `);

    // Factory directory is now per-user (each login keeps its own factories) and
    // supports multiple email addresses per factory.
    await client.query(`ALTER TABLE factories ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);`);
    await client.query(`ALTER TABLE factories ADD COLUMN IF NOT EXISTS emails TEXT[];`);
    // Contact person the emails are addressed to (e.g. "Beddy").
    await client.query(`ALTER TABLE factories ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);`);
    // Divisions a factory serves (a factory can belong to several). Filtering the
    // invite picker uses this so, e.g., a Hydration project only shows Hydration
    // factories. Pre-existing factories (all drinkware) backfill to Hydration.
    await client.query(`ALTER TABLE factories ADD COLUMN IF NOT EXISTS divisions TEXT[];`);
    await client.query(`UPDATE factories SET divisions = ARRAY['Hydration'] WHERE divisions IS NULL;`);
    // Backfill the new emails[] array from the legacy single email column.
    await client.query(`
      UPDATE factories
         SET emails = CASE WHEN email IS NOT NULL AND btrim(email) <> ''
                           THEN ARRAY[btrim(email)] ELSE ARRAY[]::text[] END
       WHERE emails IS NULL;
    `);
    // Assign any pre-existing (ownerless) factories to the first/admin user so
    // they don't vanish from the directory once we scope by owner.
    await client.query(`UPDATE factories SET created_by = (SELECT MIN(id) FROM users) WHERE created_by IS NULL;`);
    // Uniqueness is now per-owner, not global, so two users can each have "ABC".
    await client.query(`DROP INDEX IF EXISTS factories_name_lower_idx;`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS factories_owner_name_idx ON factories (created_by, LOWER(name));`);

    // Per-user email templates (personalized formats). One row per (user, type);
    // absence means "use the built-in default". Bodies use [Placeholder] tokens.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_email_templates (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        subject TEXT,
        body TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, type)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_items (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        item_index INTEGER NOT NULL,
        style_num VARCHAR(255),
        description TEXT,
        image_path VARCHAR(512),
        UNIQUE(project_id, item_index)
      );
    `);

    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS item_index INTEGER;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_path VARCHAR(512);`);

    // Landed-cost columns: listed in the CREATE TABLE above, but that is a
    // no-op on the pre-existing quotes table, so add them explicitly. Their
    // absence was silently 500ing winner-selection and every landed-cost save.
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS total_fob NUMERIC(10,4);`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS base_duty_pct NUMERIC(10,4);`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS addl_duty_pct NUMERIC(10,4);`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS units_per_container INTEGER;`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sell_price NUMERIC(10,4);`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS retail_price NUMERIC(10,4);`);
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS etc_amt NUMERIC(10,4) DEFAULT 0.10;`);

    // Multiple reference photos per outbound item row (the "Our Image #N" columns).
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_item_images (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        item_index INTEGER NOT NULL,
        position INTEGER NOT NULL,
        image_path VARCHAR(512),
        UNIQUE(project_id, item_index, position)
      );
    `);
    await client.query(`ALTER TABLE project_items ADD COLUMN IF NOT EXISTS last_price NUMERIC(10,4);`);
    await client.query(`ALTER TABLE project_items ADD COLUMN IF NOT EXISTS moq INTEGER;`);

    // CAD-driven projects: division heads attach design files (images/PDF), then
    // build items that reference them (one CAD can back several items).
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_cads (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        file_path VARCHAR(512) NOT NULL,
        original_name VARCHAR(512),
        content_type VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE project_items ADD COLUMN IF NOT EXISTS cad_id INTEGER REFERENCES project_cads(id) ON DELETE SET NULL;`);
    // Factories now quote lead time per item (inline dashboard).
    await client.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_time VARCHAR(100);`);

    // Pre-existing bug: deleting an invited factory 500'd whenever it had an
    // auto-generated vendor token, since this FK had no ON DELETE behavior.
    await client.query(`ALTER TABLE vendor_tokens DROP CONSTRAINT IF EXISTS vendor_tokens_project_factory_id_fkey;`);
    await client.query(`
      ALTER TABLE vendor_tokens ADD CONSTRAINT vendor_tokens_project_factory_id_fkey
        FOREIGN KEY (project_factory_id) REFERENCES project_factories(id) ON DELETE CASCADE;
    `);
    // Same class of bug: deleting a project 500'd if it had vendor tokens.
    await client.query(`ALTER TABLE vendor_tokens DROP CONSTRAINT IF EXISTS vendor_tokens_project_id_fkey;`);
    await client.query(`
      ALTER TABLE vendor_tokens ADD CONSTRAINT vendor_tokens_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    `);

    // Backfill item_index for quotes imported before this column existed.
    // The old parser required a style_num on every row it kept, so every
    // pre-existing row has one — rank distinct style_nums per project to
    // preserve the exact grouping the old style_num-based Compare tab used.
    await client.query(`
      WITH ranked AS (
        SELECT id, DENSE_RANK() OVER (PARTITION BY project_id ORDER BY style_num) AS rnk
        FROM quotes
        WHERE item_index IS NULL AND style_num IS NOT NULL
      )
      UPDATE quotes q SET item_index = ranked.rnk
      FROM ranked WHERE q.id = ranked.id;
    `);

    // Multi-tenant foundation: each user belongs to an organization, and each
    // organization carries its own branding so the app can be white-labelled
    // per login later. Current single-tenant (Shalom) behavior is unchanged —
    // this just puts the structure in place.
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo_mark VARCHAR(8),
        logo_title VARCHAR(255),
        logo_sub VARCHAR(255),
        brand_color VARCHAR(16),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id);`);
    // Seed the default org with the current Shalom branding (only if none yet).
    await client.query(`
      INSERT INTO organizations (name, logo_mark, logo_title, logo_sub, brand_color)
      SELECT 'Shalom International', 'S', 'Shalom International', 'Bid Consolidator', '#0f172a'
      WHERE NOT EXISTS (SELECT 1 FROM organizations);
    `);
    // Attach any user without an org to the default org.
    await client.query(`
      UPDATE users SET org_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
      WHERE org_id IS NULL;
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
