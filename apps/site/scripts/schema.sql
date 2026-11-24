-- The public site's own small database (not the Three Wolves database).
-- Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS site_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('waitlist','walkthrough','invite','app','contact')),
  email         text NOT NULL,
  name          text,
  club          text,
  sport         text,
  city          text,
  role          text CHECK (role IS NULL OR role IN ('organiser','player')),
  message       text,
  extra         jsonb NOT NULL DEFAULT '{}'::jsonb,
  locale        text NOT NULL CHECK (locale IN ('en','vi')),
  consent_text  text NOT NULL,
  consent_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
  token_hash    text NOT NULL,
  confirmed_at  timestamptz,
  team_notified_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One row per person per form: sending a form twice updates the first row.
CREATE UNIQUE INDEX IF NOT EXISTS site_submissions_kind_email ON site_submissions (kind, lower(email));
CREATE INDEX IF NOT EXISTS site_submissions_token ON site_submissions (token_hash);

-- Rate limiting: a salted hash of the address, never the address itself.
-- Rows older than a day are purged (app/api/cron/purge).
CREATE TABLE IF NOT EXISTS site_rate_limits (
  id          bigserial PRIMARY KEY,
  bucket      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_rate_limits_bucket ON site_rate_limits (bucket, created_at);

-- Email captured instead of sent, outside production (previews, local, CI).
CREATE TABLE IF NOT EXISTS site_captured_emails (
  id          bigserial PRIMARY KEY,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
