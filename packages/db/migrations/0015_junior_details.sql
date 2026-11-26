-- Phase 3b: the details the audit of 25 Nov found in the junior tables
-- ("Migration 0012 details"). Additive, on tables that are empty in
-- production: no row changes there.
--
-- 1. junior_attendance: a child can only be marked at a play day that exists
--    in their club, and `source` is one of the three ways it can be recorded.
-- 2. guardianships becomes club-owned: tenant_id (named by the app, no
--    default), tied to the child's own club, with row-level security like
--    every other club-owned table. Until now it was platform-wide, so the
--    app's database role could write a guardianship for any club's child.
-- 3. guardianships.ended_at: a guardian who steps away keeps their row, so
--    what they booked and agreed to keeps its history. Only a row that hasn't
--    ended gives access.
-- 4. junior_bookings: the account that booked must be (or have been) a
--    guardian of that child, in that club.
-- 5. guardianships is the one source of truth for who a child's guardians
--    are. junior_profiles.guardian_user_id stops being required: it only
--    recorded who created the profile, and nothing reads it for access. The
--    column itself is dropped in a later, separate step.
-- 6. junior_profiles_tenant_id_idx duplicated the unique key on the same
--    columns (junior_profiles_tenant_id_id_key).

ALTER TABLE junior_attendance ADD CONSTRAINT junior_attendance_session_date_fkey FOREIGN KEY (tenant_id, session_date) REFERENCES sessions(tenant_id, date) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE junior_attendance ADD CONSTRAINT junior_attendance_source_check CHECK (source = ANY (ARRAY['roster'::text, 'coach'::text, 'admin'::text]));
--> statement-breakpoint
ALTER TABLE guardianships ADD COLUMN tenant_id integer;
--> statement-breakpoint
ALTER TABLE guardianships ADD COLUMN ended_at timestamp with time zone;
--> statement-breakpoint
-- Empty in production. Anywhere a row exists (a test database), it takes its child's club.
UPDATE guardianships g SET tenant_id = j.tenant_id FROM junior_profiles j WHERE j.id = g.junior_profile_id AND g.tenant_id IS NULL;
--> statement-breakpoint
ALTER TABLE guardianships ALTER COLUMN tenant_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE guardianships ADD CONSTRAINT guardianships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE guardianships ADD CONSTRAINT guardianships_junior_in_club_fkey FOREIGN KEY (tenant_id, junior_profile_id) REFERENCES junior_profiles(tenant_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
-- The target of the booking's foreign key below.
ALTER TABLE guardianships ADD CONSTRAINT guardianships_tenant_guardian_junior_key UNIQUE (tenant_id, guardian_user_id, junior_profile_id);
--> statement-breakpoint
ALTER TABLE junior_bookings ADD CONSTRAINT junior_bookings_booked_by_guardian_fkey FOREIGN KEY (tenant_id, booked_by_user_id, junior_profile_id) REFERENCES guardianships(tenant_id, guardian_user_id, junior_profile_id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE junior_profiles ALTER COLUMN guardian_user_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX junior_profiles_tenant_id_idx;
--> statement-breakpoint
ALTER TABLE guardianships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guardianships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON guardianships FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guardianships TO luvallplay_app;
