-- For tests that start from an older shape of the database: the roles tables
-- as they are after migrations 0003, 0004 and 0010 (a clubs table with Three
-- Wolves as club 1, a club column on roles, invites and the audit log, and
-- the roles key per club). Idempotent, and leaves a real tenants table as it is.
CREATE TABLE IF NOT EXISTS tenants (id serial PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants) THEN INSERT INTO tenants (id, slug, name) VALUES (1, 'three-wolves', 'Three Wolves'); END IF;
END $$;
ALTER TABLE club_roles ADD COLUMN IF NOT EXISTS tenant_id integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS club_roles_tenant_key ON club_roles (tenant_id, player_id);
ALTER TABLE IF EXISTS admin_invites ADD COLUMN IF NOT EXISTS tenant_id integer NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS admin_audit_log ADD COLUMN IF NOT EXISTS tenant_id integer NOT NULL DEFAULT 1;
-- 0007: the club a scoped connection names (none: NULL).
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS integer
LANGUAGE sql STABLE
AS $fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer $fn$;
