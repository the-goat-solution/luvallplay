-- Phase 3b step 6: the safety check a club records for a coach or volunteer
-- before they work with juniors.
--
-- Additive: one new table and nothing else. Club-owned with row-level
-- security from the first day.
--
-- Luvallplay records THAT a check exists, its kind, the club's own reference
-- and when it expires. It never holds the check's document or result, and it
-- does not carry out or verify a check.
CREATE TABLE junior_safety_checks (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  -- The coach or volunteer the check is about.
  user_id integer NOT NULL,
  kind text NOT NULL,
  -- The club's own reference for where the record is kept. Optional.
  reference text,
  checked_on date NOT NULL,
  expires_on date NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The owner who recorded it.
  recorded_by_user_id integer NOT NULL,
  -- Set when the club withdraws the record before it expires.
  revoked_at timestamp with time zone,
  revoked_by_user_id integer,
  CONSTRAINT junior_safety_checks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_safety_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_safety_checks_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_safety_checks_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_safety_checks_kind_check CHECK (kind = ANY (ARRAY['police-vet'::text, 'working-with-children'::text, 'other'::text])),
  CONSTRAINT junior_safety_checks_dates_check CHECK (expires_on > checked_on)
);
--> statement-breakpoint
CREATE INDEX junior_safety_checks_user_idx ON junior_safety_checks (tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX junior_safety_checks_user_id_idx ON junior_safety_checks (user_id);
--> statement-breakpoint
CREATE INDEX junior_safety_checks_recorded_by_user_id_idx ON junior_safety_checks (recorded_by_user_id);
--> statement-breakpoint
CREATE INDEX junior_safety_checks_revoked_by_user_id_idx ON junior_safety_checks (revoked_by_user_id);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE junior_safety_checks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE junior_safety_checks FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON junior_safety_checks FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
  GRANT SELECT, INSERT, UPDATE ON junior_safety_checks TO luvallplay_app;
  -- A record of a check is withdrawn (revoked_at), never deleted.
  REVOKE DELETE ON junior_safety_checks FROM luvallplay_app;
  GRANT USAGE, SELECT ON SEQUENCE junior_safety_checks_id_seq TO luvallplay_app;
END $$;
