-- Per-account outbound proxy; password uses the existing credential encryption.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS proxy_type TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS proxy_host TEXT,
  ADD COLUMN IF NOT EXISTS proxy_port INTEGER,
  ADD COLUMN IF NOT EXISTS proxy_username TEXT,
  ADD COLUMN IF NOT EXISTS proxy_password TEXT;
