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

CREATE INDEX IF NOT EXISTS idx_contact_submissions_ip_created_at
  ON contact_submissions (ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS csp_reports (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  document_uri         TEXT,
  blocked_uri          TEXT,
  effective_directive  TEXT,
  violated_directive   TEXT,
  disposition          TEXT,
  referrer             TEXT,
  source_file          TEXT,
  line_number          INTEGER,
  column_number        INTEGER,
  status_code          INTEGER,
  user_agent           TEXT,
  ip_address           TEXT,
  country              TEXT,
  raw_report           TEXT    NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_csp_reports_created_at
  ON csp_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_csp_reports_effective_directive
  ON csp_reports (effective_directive);
