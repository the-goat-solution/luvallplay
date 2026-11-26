-- Phase 3b step 4: a club's forms and waivers, and who signed them.
--
-- Additive: two new tables and nothing else. Both are club-owned with
-- row-level security from the first day.
--
-- A form's text is never edited: changing the wording publishes a new
-- VERSION (a new row), so a signature always points at the exact words that
-- were signed. Signatures are never updated (the app's database role has no
-- UPDATE on them).
CREATE TABLE club_forms (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  -- The form's stable name within the club, e.g. "junior-waiver".
  slug text NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamp with time zone DEFAULT now() NOT NULL,
  published_by_user_id integer NOT NULL,
  -- Set when the club stops asking for this form. Its signatures are kept.
  retired_at timestamp with time zone,
  CONSTRAINT club_forms_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT club_forms_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT club_forms_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT club_forms_one_per_version UNIQUE (tenant_id, slug, version),
  CONSTRAINT club_forms_kind_check CHECK (kind = ANY (ARRAY['waiver'::text, 'consent'::text])),
  CONSTRAINT club_forms_version_check CHECK (version >= 1),
  CONSTRAINT club_forms_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE INDEX club_forms_published_by_user_id_idx ON club_forms (published_by_user_id);
--> statement-breakpoint
CREATE TABLE form_signatures (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  form_id integer NOT NULL,
  -- The child the form was signed for.
  junior_profile_id integer NOT NULL,
  -- The guardian who signed, and the name they typed as their signature.
  signed_by_user_id integer NOT NULL,
  signed_name text NOT NULL,
  signed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT form_signatures_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT form_signatures_form_in_club_fkey FOREIGN KEY (tenant_id, form_id) REFERENCES club_forms(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT form_signatures_junior_profile_id_fkey FOREIGN KEY (junior_profile_id) REFERENCES junior_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT form_signatures_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT form_signatures_signed_by_user_id_fkey FOREIGN KEY (signed_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT form_signatures_once UNIQUE (tenant_id, form_id, junior_profile_id, signed_by_user_id)
);
--> statement-breakpoint
CREATE INDEX form_signatures_junior_profile_id_idx ON form_signatures (junior_profile_id);
--> statement-breakpoint
CREATE INDEX form_signatures_signed_by_user_id_idx ON form_signatures (signed_by_user_id);
--> statement-breakpoint
CREATE INDEX form_signatures_form_idx ON form_signatures (tenant_id, form_id);
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['club_forms', 'form_signatures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
  -- New tables get every right by default (0007). Take back what must not happen:
  -- a published form is never deleted, and a signature is a record that is
  -- written once and removed only with the child's data.
  REVOKE DELETE ON club_forms FROM luvallplay_app;
  REVOKE UPDATE ON form_signatures FROM luvallplay_app;
END $$;
