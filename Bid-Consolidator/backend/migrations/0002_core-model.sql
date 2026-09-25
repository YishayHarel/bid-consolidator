-- Up Migration
-- Core data model. Replaces string/position join keys with real foreign keys,
-- adds org tenancy, enforces quote/winner uniqueness in the database, and adds
-- the file-tracking and job-queue tables. Runs in one transaction (all or
-- nothing). Written to tolerate the messy legacy data found in production:
-- items that only existed implicitly through quotes, quotes from factories that
-- were never formally invited, and case-variant factory names.

-- ============================================================================
-- 0. Shared helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. Organizations: sign-up domains + per-org settings (landed-cost constants)
-- ============================================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_domains TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

INSERT INTO organizations (name, logo_mark, logo_title, logo_sub, brand_color)
SELECT 'Shalom International', 'S', 'Shalom International', 'Bid Consolidator', '#0f172a'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- ============================================================================
-- 2. Users: every user belongs to an org; roles are admin | member
-- ============================================================================
UPDATE users SET org_id = (SELECT min(id) FROM organizations) WHERE org_id IS NULL;
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;

-- The original admin account (admin@shalom.com) is the only admin; everyone
-- else becomes a member. If that account doesn't exist, users who already had
-- the legacy 'admin' role keep it, so an organization is never left without an
-- admin. New sign-ups default to member.
UPDATE users SET role = CASE
  WHEN lower(email) = 'admin@shalom.com' THEN 'admin'
  WHEN role = 'admin' AND NOT EXISTS (SELECT 1 FROM users u2 WHERE lower(u2.email) = 'admin@shalom.com') THEN 'admin'
  ELSE 'member'
END;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (lower(email));

-- Seed each org's sign-up domains from its members' work email domains
-- (public webmail and non-routable test domains excluded).
UPDATE organizations o
   SET allowed_domains = d.domains
  FROM (
    SELECT org_id, array_agg(DISTINCT lower(split_part(email, '@', 2))) AS domains
      FROM users
     WHERE lower(split_part(email, '@', 2)) NOT IN
           ('gmail.com','googlemail.com','yahoo.com','outlook.com','hotmail.com','live.com','msn.com',
            'icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com','mail.com')
       AND split_part(email, '@', 2) !~* '\.(local|test|example|invalid|localhost)$'
     GROUP BY org_id
  ) d
 WHERE o.id = d.org_id AND cardinality(o.allowed_domains) = 0;

CREATE TABLE org_invites (
  id          BIGSERIAL PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX org_invites_org_idx ON org_invites (org_id, created_at DESC);

-- ============================================================================
-- 3. Projects: org-scoped, owned by a user; per-project settings overrides
-- ============================================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id);
UPDATE projects p
   SET org_id = COALESCE((SELECT u.org_id FROM users u WHERE u.id = p.created_by),
                         (SELECT min(id) FROM organizations))
 WHERE p.org_id IS NULL;
ALTER TABLE projects ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (org_id, created_by, created_at DESC);

-- ============================================================================
-- 4. Factory directory: org-scoped, unique per (org, lower(name))
-- ============================================================================
ALTER TABLE factories ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id);
UPDATE factories f
   SET org_id = COALESCE((SELECT u.org_id FROM users u WHERE u.id = f.created_by),
                         (SELECT min(id) FROM organizations))
 WHERE f.org_id IS NULL;
ALTER TABLE factories ALTER COLUMN org_id SET NOT NULL;
UPDATE factories
   SET emails = CASE WHEN email IS NOT NULL AND btrim(email) <> '' THEN ARRAY[btrim(email)] ELSE '{}' END
 WHERE emails IS NULL;
UPDATE factories SET divisions = '{}' WHERE divisions IS NULL;
ALTER TABLE factories ALTER COLUMN emails SET DEFAULT '{}';
ALTER TABLE factories ALTER COLUMN emails SET NOT NULL;
ALTER TABLE factories ALTER COLUMN divisions SET DEFAULT '{}';
ALTER TABLE factories ALTER COLUMN divisions SET NOT NULL;
ALTER TABLE factories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER factories_updated_at BEFORE UPDATE ON factories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP INDEX IF EXISTS factories_owner_name_idx;
DROP INDEX IF EXISTS factories_name_lower_idx;
CREATE UNIQUE INDEX factories_org_name_uidx ON factories (org_id, lower(name));

-- ============================================================================
-- 5. Items: materialize items that only existed implicitly through quotes.
--    The legacy Compare sheet showed project_items FULL OUTER JOIN the quotes'
--    item_index, so a project built purely from a factory upload had items only
--    in `quotes`. Create real rows for those so every quote can reference one.
-- ============================================================================
DELETE FROM project_items WHERE project_id IS NULL;
INSERT INTO project_items (project_id, item_index, style_num, description)
SELECT DISTINCT ON (q.project_id, q.item_index) q.project_id, q.item_index, q.style_num, q.description
  FROM quotes q
 WHERE q.project_id IS NOT NULL
   AND q.item_index IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM project_items pi
                    WHERE pi.project_id = q.project_id AND pi.item_index = q.item_index)
 ORDER BY q.project_id, q.item_index, q.submitted_at
ON CONFLICT (project_id, item_index) DO NOTHING;

ALTER TABLE project_items ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE project_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE project_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER project_items_updated_at BEFORE UPDATE ON project_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS project_items_active_idx ON project_items (project_id, item_index) WHERE deleted_at IS NULL;

DELETE FROM project_cads WHERE project_id IS NULL;
ALTER TABLE project_cads ALTER COLUMN project_id SET NOT NULL;

-- ============================================================================
-- 6. Factories-on-projects: every invitation, quote and portal link must point
--    at a real directory factory. First make sure the directory has an entry
--    for every name used anywhere, then give every (project, factory name) a
--    project_factories row.
-- ============================================================================
DELETE FROM project_factories WHERE project_id IS NULL;
DELETE FROM quotes WHERE project_id IS NULL;              -- unattached to any project: unusable
DELETE FROM vendor_tokens WHERE project_id IS NULL AND project_factory_id IS NULL;

INSERT INTO factories (org_id, name, emails, divisions, created_by)
SELECT DISTINCT ON (x.org_id, lower(x.name)) x.org_id, x.name, '{}', '{}', x.created_by
  FROM (
        SELECT p.org_id, pf.factory_name AS name, p.created_by
          FROM project_factories pf JOIN projects p ON p.id = pf.project_id
         WHERE pf.factory_id IS NULL
        UNION ALL
        SELECT p.org_id, q.factory_name, p.created_by
          FROM quotes q JOIN projects p ON p.id = q.project_id
        UNION ALL
        SELECT p.org_id, vt.factory_name, p.created_by
          FROM vendor_tokens vt JOIN projects p ON p.id = vt.project_id
         WHERE vt.project_factory_id IS NULL
       ) x
 WHERE x.name IS NOT NULL AND btrim(x.name) <> ''
   AND NOT EXISTS (SELECT 1 FROM factories f WHERE f.org_id = x.org_id AND lower(f.name) = lower(x.name))
 ORDER BY x.org_id, lower(x.name)
ON CONFLICT DO NOTHING;

-- Link existing invitations that have no directory factory yet.
UPDATE project_factories pf
   SET factory_id = f.id
  FROM projects p, factories f
 WHERE pf.project_id = p.id AND pf.factory_id IS NULL
   AND f.org_id = p.org_id AND lower(f.name) = lower(pf.factory_name);

-- Quotes/links from factories that were never formally invited to the project
-- (e.g. a quote the owner uploaded on a factory's behalf): create the invitation.
INSERT INTO project_factories (project_id, factory_name, factory_id, invited_at, submitted_at)
SELECT DISTINCT ON (x.project_id, lower(x.name)) x.project_id, x.name, f.id, x.first_at, x.last_at
  FROM (
        SELECT q.project_id, q.factory_name AS name, min(q.submitted_at) AS first_at, max(q.submitted_at) AS last_at
          FROM quotes q
         WHERE NOT EXISTS (SELECT 1 FROM project_factories pf
                            WHERE pf.project_id = q.project_id AND lower(pf.factory_name) = lower(q.factory_name))
         GROUP BY q.project_id, q.factory_name
        UNION ALL
        SELECT vt.project_id, vt.factory_name, min(vt.created_at), NULL
          FROM vendor_tokens vt
         WHERE vt.project_factory_id IS NULL AND vt.project_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM project_factories pf
                            WHERE pf.project_id = vt.project_id AND lower(pf.factory_name) = lower(vt.factory_name))
         GROUP BY vt.project_id, vt.factory_name
       ) x
  JOIN projects p ON p.id = x.project_id
  JOIN factories f ON f.org_id = p.org_id AND lower(f.name) = lower(x.name)
 ORDER BY x.project_id, lower(x.name), x.last_at DESC NULLS LAST
ON CONFLICT (project_id, factory_name) DO NOTHING;

-- Point quotes and portal links at their invitation (by the name used at the time).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS project_factory_id INTEGER REFERENCES project_factories(id) ON DELETE CASCADE;
UPDATE quotes q
   SET project_factory_id = (SELECT pf.id FROM project_factories pf
                              WHERE pf.project_id = q.project_id AND lower(pf.factory_name) = lower(q.factory_name)
                              ORDER BY pf.id LIMIT 1)
 WHERE q.project_factory_id IS NULL;

UPDATE vendor_tokens vt
   SET project_factory_id = (SELECT pf.id FROM project_factories pf
                              WHERE pf.project_id = vt.project_id AND lower(pf.factory_name) = lower(vt.factory_name)
                              ORDER BY pf.id LIMIT 1)
 WHERE vt.project_factory_id IS NULL;

-- Collapse invitations that resolve to the same factory on the same project
-- ("Acme" and "ACME"): keep the oldest, move everything onto it.
CREATE TEMP TABLE pf_merge ON COMMIT DROP AS
SELECT id, first_value(id) OVER (PARTITION BY project_id, factory_id ORDER BY id) AS keep_id
  FROM project_factories
 WHERE factory_id IS NOT NULL;
DELETE FROM pf_merge WHERE id = keep_id;
UPDATE quotes q        SET project_factory_id = m.keep_id FROM pf_merge m WHERE q.project_factory_id = m.id;
UPDATE vendor_tokens t SET project_factory_id = m.keep_id FROM pf_merge m WHERE t.project_factory_id = m.id;
UPDATE project_factories k
   SET invited_at = LEAST(k.invited_at, d.invited_at),
       submitted_at = GREATEST(k.submitted_at, d.submitted_at)
  FROM (SELECT m.keep_id, min(pf.invited_at) AS invited_at, max(pf.submitted_at) AS submitted_at
          FROM pf_merge m JOIN project_factories pf ON pf.id = m.id
         GROUP BY m.keep_id) d
 WHERE k.id = d.keep_id;
DELETE FROM project_factories pf USING pf_merge m WHERE pf.id = m.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_factories WHERE factory_id IS NULL) THEN
    RAISE EXCEPTION 'core-model: % project_factories rows could not be linked to a factory',
      (SELECT count(*) FROM project_factories WHERE factory_id IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM quotes WHERE project_factory_id IS NULL) THEN
    RAISE EXCEPTION 'core-model: % quotes could not be attributed to a project factory',
      (SELECT count(*) FROM quotes WHERE project_factory_id IS NULL);
  END IF;
END
$$;

ALTER TABLE project_factories ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE project_factories ALTER COLUMN factory_id SET NOT NULL;
ALTER TABLE project_factories ALTER COLUMN factory_name DROP NOT NULL;   -- legacy; display name now comes from factories
ALTER TABLE project_factories DROP CONSTRAINT IF EXISTS project_factories_factory_id_fkey;
ALTER TABLE project_factories ADD CONSTRAINT project_factories_factory_id_fkey
  FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE RESTRICT;  -- a factory in use can't vanish
ALTER TABLE project_factories DROP CONSTRAINT IF EXISTS project_factories_project_id_factory_name_key;
CREATE UNIQUE INDEX project_factories_project_factory_uidx ON project_factories (project_id, factory_id);

-- ============================================================================
-- 7. Quotes: FK to the item, one quote per (item, factory), one winner per item
-- ============================================================================
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES project_items(id) ON DELETE CASCADE;
UPDATE quotes q
   SET item_id = pi.id
  FROM project_items pi
 WHERE pi.project_id = q.project_id AND pi.item_index = q.item_index AND q.item_id IS NULL;

-- A factory had several rows for the same item: keep the winner, else the latest.
DELETE FROM quotes q
 USING (SELECT id, row_number() OVER (PARTITION BY item_id, project_factory_id
                                      ORDER BY is_selected_winner DESC NULLS LAST, submitted_at DESC NULLS LAST, id DESC) AS rn
          FROM quotes WHERE item_id IS NOT NULL) d
 WHERE q.id = d.id AND d.rn > 1;

UPDATE quotes SET is_selected_winner = false WHERE is_selected_winner IS NULL OR item_id IS NULL;
UPDATE quotes q
   SET is_selected_winner = false
  FROM (SELECT id, row_number() OVER (PARTITION BY item_id ORDER BY id DESC) AS rn
          FROM quotes WHERE is_selected_winner) w
 WHERE q.id = w.id AND w.rn > 1;

ALTER TABLE quotes ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN project_factory_id SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN factory_name DROP NOT NULL;   -- legacy
ALTER TABLE quotes ALTER COLUMN is_selected_winner SET DEFAULT false;
ALTER TABLE quotes ALTER COLUMN is_selected_winner SET NOT NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX quotes_item_factory_uidx ON quotes (item_id, project_factory_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX quotes_one_winner_uidx ON quotes (item_id) WHERE is_selected_winner;
CREATE INDEX IF NOT EXISTS quotes_project_idx ON quotes (project_id);
CREATE INDEX IF NOT EXISTS quotes_pf_idx ON quotes (project_factory_id);

-- ============================================================================
-- 8. Portal links: always tied to an invitation; quote vs revision round
-- ============================================================================
DELETE FROM vendor_tokens WHERE project_factory_id IS NULL;   -- no project to quote on
ALTER TABLE vendor_tokens ALTER COLUMN project_factory_id SET NOT NULL;
ALTER TABLE vendor_tokens ALTER COLUMN factory_name DROP NOT NULL;   -- legacy
ALTER TABLE vendor_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'quote'
  CHECK (purpose IN ('quote', 'revision'));
CREATE INDEX IF NOT EXISTS vendor_tokens_pf_idx ON vendor_tokens (project_factory_id, created_at DESC);

-- ============================================================================
-- 9. Item images: keyed by the item, not (project, position)
-- ============================================================================
ALTER TABLE project_item_images ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES project_items(id) ON DELETE CASCADE;
UPDATE project_item_images pii
   SET item_id = pi.id
  FROM project_items pi
 WHERE pi.project_id = pii.project_id AND pi.item_index = pii.item_index AND pii.item_id IS NULL;
DELETE FROM project_item_images WHERE item_id IS NULL;
-- items that carried an image only on the legacy column
INSERT INTO project_item_images (project_id, item_index, item_id, "position", image_path)
SELECT pi.project_id, pi.item_index, pi.id, 0, pi.image_path
  FROM project_items pi
 WHERE pi.image_path IS NOT NULL AND pi.image_path <> ''
   AND NOT EXISTS (SELECT 1 FROM project_item_images x WHERE x.item_id = pi.id AND x."position" = 0);
ALTER TABLE project_item_images ALTER COLUMN item_id SET NOT NULL;
ALTER TABLE project_item_images ALTER COLUMN item_index DROP NOT NULL;   -- legacy
ALTER TABLE project_item_images DROP CONSTRAINT IF EXISTS project_item_images_project_id_item_index_position_key;
CREATE UNIQUE INDEX project_item_images_item_pos_uidx ON project_item_images (item_id, "position");

-- ============================================================================
-- 10. Stored objects: every file in storage is tracked, so deleting a project
--     can reliably delete its files (and orphans can be swept).
-- ============================================================================
CREATE TABLE stored_objects (
  key                  TEXT PRIMARY KEY,
  org_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           INTEGER,   -- intentionally no FK: must outlive the project for the purge job
  content_type         TEXT,
  size_bytes           BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_requested_at  TIMESTAMPTZ,
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX stored_objects_project_idx ON stored_objects (project_id);
CREATE INDEX stored_objects_purge_idx ON stored_objects (delete_requested_at)
  WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL;

INSERT INTO stored_objects (key, org_id, project_id)
SELECT DISTINCT ON (k.key) k.key, p.org_id, p.id
  FROM (
        SELECT project_id, file_path AS key FROM project_cads
        UNION ALL SELECT project_id, image_path FROM project_items
        UNION ALL SELECT pi.project_id, pii.image_path
                    FROM project_item_images pii JOIN project_items pi ON pi.id = pii.item_id
        UNION ALL SELECT project_id, image_path FROM quotes
        UNION ALL SELECT id, template_path FROM projects
       ) k
  JOIN projects p ON p.id = k.project_id
 WHERE k.key IS NOT NULL AND k.key <> ''
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 11. Background jobs (Excel import, AI CAD detection, quote upload, purges).
--     A Postgres-backed queue: workers claim with FOR UPDATE SKIP LOCKED, so it
--     is safe with several server instances. Users see their own job progress.
-- ============================================================================
CREATE TABLE jobs (
  id            BIGSERIAL PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  state         TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message       TEXT,
  result        JSONB,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX jobs_ready_idx ON jobs (run_after, id) WHERE state = 'queued';
CREATE INDEX jobs_stale_idx ON jobs (locked_at) WHERE state = 'running';
CREATE INDEX jobs_project_idx ON jobs (project_id, created_at DESC);

-- ============================================================================
-- 12. Email log: what was sent to whom, so "sent"/"last reminded" survives a
--     page refresh and follow-ups can be timed.
-- ============================================================================
CREATE TABLE email_log (
  id                  BIGSERIAL PRIMARY KEY,
  org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  project_factory_id  INTEGER REFERENCES project_factories(id) ON DELETE SET NULL,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type                TEXT NOT NULL,
  recipients          TEXT[] NOT NULL,
  subject             TEXT NOT NULL,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_project_idx ON email_log (project_id, sent_at DESC);

-- Down Migration
-- This migration transforms data (merges duplicates, materializes items) and
-- cannot be reversed faithfully. Restore the pre-migration backup instead.
DO $$ BEGIN RAISE EXCEPTION 'core-model is irreversible: restore from the pre-migration backup'; END $$;
