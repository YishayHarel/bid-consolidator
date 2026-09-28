-- Up Migration
-- Indexes for lookups the app runs on every page load, so they stay fast as
-- data grows (each one was a full-table scan before). Purely additive.

-- "Last emailed" per invited factory (Emails and Factories tabs).
CREATE INDEX email_log_pf_sent_idx ON email_log (project_factory_id, sent_at DESC) WHERE project_factory_id IS NOT NULL;
-- A project's uploaded CAD files.
CREATE INDEX project_cads_project_idx ON project_cads (project_id, id);
-- Items created from a CAD (also makes deleting a CAD fast).
CREATE INDEX project_items_cad_idx ON project_items (cad_id) WHERE cad_id IS NOT NULL;
-- "Is this file still used?" checks before a stored file is deleted.
CREATE INDEX project_item_images_path_idx ON project_item_images (image_path) WHERE image_path IS NOT NULL;
CREATE INDEX quotes_image_path_idx ON quotes (image_path) WHERE image_path IS NOT NULL;
-- "Is this factory used by any project?" (directory delete guard).
CREATE INDEX project_factories_factory_idx ON project_factories (factory_id);
-- An organization's members (Settings → Members).
CREATE INDEX users_org_idx ON users (org_id);

-- Down Migration
DROP INDEX IF EXISTS users_org_idx;
DROP INDEX IF EXISTS project_factories_factory_idx;
DROP INDEX IF EXISTS quotes_image_path_idx;
DROP INDEX IF EXISTS project_item_images_path_idx;
DROP INDEX IF EXISTS project_items_cad_idx;
DROP INDEX IF EXISTS project_cads_project_idx;
DROP INDEX IF EXISTS email_log_pf_sent_idx;
