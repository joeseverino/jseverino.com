-- Contact form submissions for jseverino.com.
--
-- Apply to the remote D1 database:
--   wrangler d1 execute jseverino-contact --remote --file=./db/schema.sql
-- Apply to the local dev database (used by `wrangler pages dev`):
--   wrangler d1 execute jseverino-contact --local --file=./db/schema.sql

CREATE TABLE IF NOT EXISTS contact_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'unread',
  turnstile    TEXT    NOT NULL DEFAULT 'verified',
  ip_address   TEXT,
  user_agent   TEXT,
  browser      TEXT,
  device       TEXT,
  country      TEXT,
  source_url   TEXT,
  assigned_to  TEXT,
  admin_notes  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at
  ON contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_status
  ON contact_submissions (status);
