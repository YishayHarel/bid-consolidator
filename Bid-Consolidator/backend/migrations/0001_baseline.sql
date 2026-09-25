-- Up Migration
-- Baseline: the schema exactly as the legacy migrate.js left it (captured from
-- a pg_dump of that schema). Existing databases already have it, so this is a
-- no-op there; a fresh database gets built identically. Guarded as a whole on
-- the presence of the `users` table so it never touches a live schema.
DO $baseline$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    RAISE NOTICE 'baseline: legacy schema present, skipping';
    RETURN;
  END IF;

  CREATE TABLE organizations (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    logo_mark    VARCHAR(8),
    logo_title   VARCHAR(255),
    logo_sub     VARCHAR(255),
    brand_color  VARCHAR(16),
    created_at   TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    role        VARCHAR(50) DEFAULT 'internal',
    created_at  TIMESTAMPTZ DEFAULT now(),
    org_id      INTEGER REFERENCES organizations(id)
  );

  CREATE TABLE projects (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    buyer          VARCHAR(255),
    division       VARCHAR(100),
    last_price     NUMERIC(10,4),
    status         VARCHAR(50) DEFAULT 'active',
    created_by     INTEGER REFERENCES users(id),
    created_at     TIMESTAMPTZ DEFAULT now(),
    template_path  VARCHAR(512)
  );

  CREATE TABLE project_cads (
    id             SERIAL PRIMARY KEY,
    project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    file_path      VARCHAR(512) NOT NULL,
    original_name  VARCHAR(512),
    content_type   VARCHAR(255),
    created_at     TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE project_items (
    id           SERIAL PRIMARY KEY,
    project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    item_index   INTEGER NOT NULL,
    style_num    VARCHAR(255),
    description  TEXT,
    image_path   VARCHAR(512),
    last_price   NUMERIC(10,4),
    moq          INTEGER,
    cad_id       INTEGER REFERENCES project_cads(id) ON DELETE SET NULL,
    inner_pack   INTEGER,
    master_pack  INTEGER,
    deleted_at   TIMESTAMPTZ,
    UNIQUE (project_id, item_index)
  );

  CREATE TABLE project_item_images (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    item_index  INTEGER NOT NULL,
    "position"  INTEGER NOT NULL,
    image_path  VARCHAR(512),
    UNIQUE (project_id, item_index, "position")
  );

  CREATE TABLE factories (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255),
    created_at    TIMESTAMPTZ DEFAULT now(),
    created_by    INTEGER REFERENCES users(id),
    emails        TEXT[],
    contact_name  VARCHAR(255),
    divisions     TEXT[]
  );
  CREATE UNIQUE INDEX factories_name_lower_idx ON factories (lower(name::text));

  CREATE TABLE project_factories (
    id            SERIAL PRIMARY KEY,
    project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    factory_name  VARCHAR(255) NOT NULL,
    invited_at    TIMESTAMPTZ DEFAULT now(),
    submitted_at  TIMESTAMPTZ,
    factory_id    INTEGER REFERENCES factories(id) ON DELETE SET NULL,
    UNIQUE (project_id, factory_name)
  );

  CREATE TABLE vendor_tokens (
    id                  SERIAL PRIMARY KEY,
    token               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    factory_name        VARCHAR(255) NOT NULL,
    project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    project_factory_id  INTEGER REFERENCES project_factories(id) ON DELETE CASCADE,
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE quotes (
    id                   SERIAL PRIMARY KEY,
    project_id           INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    factory_name         VARCHAR(255) NOT NULL,
    style_num            VARCHAR(255),
    description          TEXT,
    category             VARCHAR(255),
    color                VARCHAR(255),
    scent_fragrance      VARCHAR(255),
    packaging            VARCHAR(255),
    moq                  INTEGER,
    price                NUMERIC(10,4),
    benchmark_link       TEXT,
    total_fob            NUMERIC(10,4),
    base_duty_pct        NUMERIC(10,4),
    addl_duty_pct        NUMERIC(10,4),
    units_per_container  INTEGER,
    sell_price           NUMERIC(10,4),
    retail_price         NUMERIC(10,4),
    etc_amt              NUMERIC(10,4) DEFAULT 0.10,
    image_path           VARCHAR(512),
    comparison_notes     TEXT,
    is_selected_winner   BOOLEAN DEFAULT false,
    submitted_at         TIMESTAMPTZ DEFAULT now(),
    item_index           INTEGER,
    lead_time            VARCHAR(100)
  );

  CREATE TABLE user_email_templates (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,
    subject     TEXT,
    body        TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, type)
  );

  INSERT INTO organizations (name, logo_mark, logo_title, logo_sub, brand_color)
  VALUES ('Shalom International', 'S', 'Shalom International', 'Bid Consolidator', '#0f172a');
END
$baseline$;

-- Down Migration
-- The baseline is never rolled back (it would drop production data).
SELECT 1;
