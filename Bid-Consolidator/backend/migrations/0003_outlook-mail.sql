-- Up Migration
-- Sending email from each buyer's own Outlook (Microsoft 365), and batch sends.
--
-- mail_accounts: one connected mailbox per user. Tokens are encrypted by the
-- app (AES-256-GCM) before they reach the database; `address` is the mailbox
-- the buyer signed in with, which must match their login email.
CREATE TABLE mail_accounts (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL CHECK (provider IN ('microsoft')),
  address            TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  access_token_enc   TEXT,
  access_expires_at  TIMESTAMPTZ,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A batch is one background job; each email in it has a key, so a retried
-- job never sends the same email twice.
ALTER TABLE email_log
  ADD COLUMN job_id   BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN item_key TEXT,
  ADD COLUMN sent_via TEXT;
CREATE UNIQUE INDEX email_log_job_item_uidx ON email_log (job_id, item_key) WHERE job_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS email_log_job_item_uidx;
ALTER TABLE email_log DROP COLUMN IF EXISTS job_id, DROP COLUMN IF EXISTS item_key, DROP COLUMN IF EXISTS sent_via;
DROP TABLE IF EXISTS mail_accounts;
