-- Phase 3b step 4: a child's emergency contacts and medical notes.
--
-- Additive: two new tables and nothing else. Both are club-owned with
-- row-level security from the first day, and every row must belong to a child
-- in the same club (the composite foreign key).
--
-- junior_medical_notes holds ONLY sealed text: the note is encrypted by the
-- application (envelope encryption bound to the club and the child) before it
-- reaches the database, so the database, its backups and its dumps never hold
-- a readable note.
CREATE TABLE junior_emergency_contacts (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  junior_profile_id integer NOT NULL,
  -- 1 is who to call first.
  position smallint DEFAULT 1 NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  relationship text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The guardian who wrote it.
  updated_by_user_id integer NOT NULL,
  CONSTRAINT junior_emergency_contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_emergency_contacts_junior_profile_id_fkey FOREIGN KEY (junior_profile_id) REFERENCES junior_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT junior_emergency_contacts_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT junior_emergency_contacts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_emergency_contacts_position_check CHECK (position BETWEEN 1 AND 3),
  CONSTRAINT junior_emergency_contacts_one_per_position UNIQUE (tenant_id, junior_profile_id, position)
);
--> statement-breakpoint
CREATE INDEX junior_emergency_contacts_junior_profile_id_idx ON junior_emergency_contacts (junior_profile_id);
--> statement-breakpoint
CREATE INDEX junior_emergency_contacts_updated_by_user_id_idx ON junior_emergency_contacts (updated_by_user_id);
--> statement-breakpoint
CREATE TABLE junior_medical_notes (
  tenant_id integer NOT NULL,
  junior_profile_id integer NOT NULL,
  -- Encrypted by the application. Never plain text.
  sealed text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The guardian who wrote it.
  updated_by_user_id integer NOT NULL,
  CONSTRAINT junior_medical_notes_pkey PRIMARY KEY (tenant_id, junior_profile_id),
  CONSTRAINT junior_medical_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_medical_notes_junior_profile_id_fkey FOREIGN KEY (junior_profile_id) REFERENCES junior_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT junior_medical_notes_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT junior_medical_notes_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  -- The sealed format (version.key-id.wrapped-key.data): a plain note can't be stored by mistake.
  CONSTRAINT junior_medical_notes_sealed_check CHECK (sealed ~ '^v1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
CREATE INDEX junior_medical_notes_junior_profile_id_idx ON junior_medical_notes (junior_profile_id);
--> statement-breakpoint
CREATE INDEX junior_medical_notes_updated_by_user_id_idx ON junior_medical_notes (updated_by_user_id);
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['junior_emergency_contacts', 'junior_medical_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO luvallplay_app', t);
  END LOOP;
  GRANT USAGE, SELECT ON SEQUENCE junior_emergency_contacts_id_seq TO luvallplay_app;
END $$;
