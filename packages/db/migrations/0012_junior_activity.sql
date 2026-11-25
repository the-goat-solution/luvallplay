-- Phase 3b, step 1: where a junior's activity lives (build plan §6.8).
--
-- A junior has no account, no email and no phone. The existing booking and
-- attendance tables are keyed by an account's email, and everything that
-- reads them (stats, boards, the calendar, reminders, exports) assumes a row
-- belongs to an adult who can be emailed. So a child's bookings and
-- attendance get tables of their own, pointing at the junior profile:
-- nothing that exists today reads them, a child can't be emailed or listed
-- by a query that never sees their rows, and adults see no change.
--
-- Additive: two new, empty tables and one unique constraint on a table that
-- is empty in production. No row changes.
--
-- Club-owned from the first day: tenant_id (named by the app, no default),
-- foreign keys with ON DELETE RESTRICT, row-level security enabled and
-- forced with the same policy as every other club-owned table.

-- A junior's rows must be in the junior's own club: the pair is the target
-- of the foreign keys below.
ALTER TABLE junior_profiles ADD CONSTRAINT junior_profiles_tenant_id_id_key UNIQUE (tenant_id, id);
--> statement-breakpoint
CREATE TABLE junior_bookings (
  id serial PRIMARY KEY NOT NULL,
  tenant_id integer NOT NULL,
  junior_profile_id integer NOT NULL,
  session_date date NOT NULL,
  -- The guardian who booked, and who pays. Never the child.
  booked_by_user_id integer NOT NULL,
  payment_intent_id text,
  -- In the currency's smallest unit, with the currency beside it.
  amount_minor integer,
  currency text,
  status text DEFAULT 'pending' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  cancelled_at timestamp with time zone,
  CONSTRAINT junior_bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_bookings_junior_profile_id_fkey FOREIGN KEY (junior_profile_id) REFERENCES junior_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT junior_bookings_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT junior_bookings_session_date_fkey FOREIGN KEY (tenant_id, session_date) REFERENCES sessions(tenant_id, date) ON DELETE RESTRICT,
  CONSTRAINT junior_bookings_booked_by_user_id_fkey FOREIGN KEY (booked_by_user_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT junior_bookings_payment_intent_id_key UNIQUE (payment_intent_id),
  CONSTRAINT junior_bookings_status_check CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'refunded'::text])),
  CONSTRAINT junior_bookings_amount_check CHECK ((amount_minor IS NULL AND currency IS NULL) OR (amount_minor >= 0 AND currency ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
-- One live booking per child per play day.
CREATE UNIQUE INDEX junior_bookings_one_live ON junior_bookings (tenant_id, junior_profile_id, session_date) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));
--> statement-breakpoint
CREATE INDEX junior_bookings_junior_profile_id_idx ON junior_bookings (junior_profile_id);
--> statement-breakpoint
CREATE INDEX junior_bookings_session_idx ON junior_bookings (tenant_id, session_date);
--> statement-breakpoint
CREATE INDEX junior_bookings_booked_by_user_id_idx ON junior_bookings (booked_by_user_id);
--> statement-breakpoint
CREATE TABLE junior_attendance (
  tenant_id integer NOT NULL,
  session_date date NOT NULL,
  junior_profile_id integer NOT NULL,
  source text NOT NULL,
  removed boolean DEFAULT false NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The coach or admin who marked it.
  recorded_by_user_id integer,
  CONSTRAINT junior_attendance_pkey PRIMARY KEY (tenant_id, session_date, junior_profile_id),
  CONSTRAINT junior_attendance_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT junior_attendance_junior_profile_id_fkey FOREIGN KEY (junior_profile_id) REFERENCES junior_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT junior_attendance_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT junior_attendance_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES players(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX junior_attendance_junior_profile_id_idx ON junior_attendance (junior_profile_id);
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['junior_bookings', 'junior_attendance'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO luvallplay_app', t);
  END LOOP;
  GRANT USAGE, SELECT ON SEQUENCE junior_bookings_id_seq TO luvallplay_app;
END $$;
