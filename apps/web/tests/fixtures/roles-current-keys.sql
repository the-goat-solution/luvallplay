-- For tests that start from an older shape of the database: the roles table
-- as it is after migrations 0004 and 0010 (a club column, and the key per club).
ALTER TABLE club_roles ADD COLUMN IF NOT EXISTS tenant_id integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS club_roles_tenant_key ON club_roles (tenant_id, player_id);
