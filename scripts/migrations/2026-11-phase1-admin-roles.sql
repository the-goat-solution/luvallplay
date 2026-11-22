-- Phase 1: admin access by player account (build plan §2.4).
--
-- Class: ADDITIVE + identity-affecting (test plan §4.1). Five new tables,
-- nothing existing is altered, renamed or dropped. Idempotent: safe to run
-- twice. Forward-only. Rehearse with:
--
--   npm run data-guard -- rehearse \
--     --expect scripts/data-guard/expectations/2026-11-phase1-admin-roles.json \
--     --run "node scripts/run-migration.mjs scripts/migrations/2026-11-phase1-admin-roles.sql \
--            && node scripts/grant-role.mjs --role owner --platform --email <timba> --email <kelcee>"
--
-- New foreign keys to accounts use ON DELETE RESTRICT (test plan §4.2).
-- Actor columns in the audit log have no foreign key on purpose: the log must
-- outlive whatever it describes.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- One club today (Three Wolves). Phase 3 turns this into club_members.role
-- with a tenant_id.
CREATE TABLE IF NOT EXISTS club_roles (
  player_id  INT PRIMARY KEY REFERENCES players(id) ON DELETE RESTRICT,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'coach')),
  granted_by INT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Luvallplay staff: the same admin rights for every club, plus the
-- Platform → Admins page.
CREATE TABLE IF NOT EXISTS platform_admins (
  player_id  INT PRIMARY KEY REFERENCES players(id) ON DELETE RESTRICT,
  granted_by INT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Add an admin by email" for someone without an account yet: the role is
-- applied the first time that email signs in.
CREATE TABLE IF NOT EXISTS admin_invites (
  id                 SERIAL PRIMARY KEY,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'coach')),
  invited_by         INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at        TIMESTAMPTZ,
  accepted_player_id INT,
  revoked_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_invites_one_pending
  ON admin_invites (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Who did what, when, to whom. Every admin action writes a row.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_player_id INT,
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('player', 'break-glass', 'script', 'system')),
  action          TEXT NOT NULL,
  target          TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_audit_log_at ON admin_audit_log (at DESC);

-- Single-use, 60-second links that open admin already signed in (the native
-- app's "Club admin" button). Only the token's hash is stored.
CREATE TABLE IF NOT EXISTS admin_handoffs (
  id         SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  player_id  INT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
