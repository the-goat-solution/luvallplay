-- Phase 3 step 3: email links → user_id (build plan §6.1, §6.6 steps 2–3;
-- test plan §4.5 "Email → user id links").
--
-- Class: transforming (test plan §4.1). Ten tables that find their person by
-- email alone gain a nullable user_id with a foreign key to the account
-- (ON DELETE RESTRICT) and an index. The email stays, as the contact field,
-- and nothing reads user_id yet: reads switch in step 11, after shadow reads.
--
-- Backfill: user_id = the LIVE account whose email is the row's email
-- (trimmed, lower-cased; account emails are stored that way and are unique).
-- Rows for people without an account (guests, members who never signed in)
-- keep user_id NULL and are linked the moment the account exists. Tables are
-- a few hundred rows, so the backfill is one statement per table inside this
-- transaction; it is idempotent (running it again changes nothing).
--
-- Keeping it in step, whichever app version writes: two trigger functions.
-- The previous app version doesn't know the column, so the link can't be
-- left to app code (test plan §0 rule 3).
--
--   link_row_to_account()    on each of the ten tables, BEFORE INSERT OR
--     UPDATE OF email: a new row, or a row whose email changes (an account
--     email change, a merge), points at the live account with that email,
--     or at nobody.
--   link_account_to_rows()   on players, AFTER INSERT OR UPDATE OF email,
--     deleted_at: a new account (or a new email) picks up the rows already
--     stored under its email, exactly as the email joins do today; a
--     soft-deleted account lets go of its rows (they stay, with their email,
--     and are no longer linked to a sign-in, as today).
--
-- The same rule the email joins follow, so a person's rows under user_id are
-- the rows they see today. scripts/tenants/verify.mjs reports any row where
-- the two disagree.
--
-- One DO block for the schema change and backfill, so the brief locks are
-- held for one round trip (as in 0004).
DO $$
BEGIN
  ALTER TABLE "attendance" ADD COLUMN "user_id" integer;
  ALTER TABLE "bookings" ADD COLUMN "user_id" integer;
  ALTER TABLE "casual_play_profiles" ADD COLUMN "user_id" integer;
  ALTER TABLE "day_requests" ADD COLUMN "user_id" integer;
  ALTER TABLE "donations" ADD COLUMN "user_id" integer;
  ALTER TABLE "jersey_registrations" ADD COLUMN "user_id" integer;
  ALTER TABLE "memberships" ADD COLUMN "user_id" integer;
  ALTER TABLE "player_absences" ADD COLUMN "user_id" integer;
  ALTER TABLE "session_fill_ins" ADD COLUMN "user_id" integer;
  ALTER TABLE "waitlist" ADD COLUMN "user_id" integer;
  UPDATE "attendance" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "bookings" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "casual_play_profiles" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "day_requests" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "donations" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "jersey_registrations" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "memberships" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "player_absences" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "session_fill_ins" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  UPDATE "waitlist" r SET user_id = p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email));
  ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "attendance_user_id_idx" ON "attendance" USING btree ("user_id");
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "bookings_user_id_idx" ON "bookings" USING btree ("user_id");
  ALTER TABLE "casual_play_profiles" ADD CONSTRAINT "casual_play_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "casual_play_profiles_user_id_idx" ON "casual_play_profiles" USING btree ("user_id");
  ALTER TABLE "day_requests" ADD CONSTRAINT "day_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "day_requests_user_id_idx" ON "day_requests" USING btree ("user_id");
  ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "donations_user_id_idx" ON "donations" USING btree ("user_id");
  ALTER TABLE "jersey_registrations" ADD CONSTRAINT "jersey_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "jersey_registrations_user_id_idx" ON "jersey_registrations" USING btree ("user_id");
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");
  ALTER TABLE "player_absences" ADD CONSTRAINT "player_absences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "player_absences_user_id_idx" ON "player_absences" USING btree ("user_id");
  ALTER TABLE "session_fill_ins" ADD CONSTRAINT "session_fill_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "session_fill_ins_user_id_idx" ON "session_fill_ins" USING btree ("user_id");
  ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "waitlist_user_id_idx" ON "waitlist" USING btree ("user_id");
END $$;
--> statement-breakpoint
CREATE FUNCTION link_row_to_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
      SELECT p.id INTO NEW.user_id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(NEW.email));
    END IF;
  ELSIF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.user_id := (SELECT p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(NEW.email)));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION link_account_to_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE "attendance" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "bookings" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "casual_play_profiles" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "day_requests" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "donations" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "jersey_registrations" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "memberships" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "player_absences" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "session_fill_ins" SET user_id = NULL WHERE user_id = NEW.id;
    UPDATE "waitlist" SET user_id = NULL WHERE user_id = NEW.id;
  ELSE
    UPDATE "attendance" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "bookings" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "casual_play_profiles" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "day_requests" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "donations" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "jersey_registrations" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "memberships" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "player_absences" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "session_fill_ins" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
    UPDATE "waitlist" SET user_id = NEW.id WHERE user_id IS NULL AND lower(trim(email)) = NEW.email;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "attendance_link_account" BEFORE INSERT OR UPDATE OF email ON "attendance" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "bookings_link_account" BEFORE INSERT OR UPDATE OF email ON "bookings" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "casual_play_profiles_link_account" BEFORE INSERT OR UPDATE OF email ON "casual_play_profiles" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "day_requests_link_account" BEFORE INSERT OR UPDATE OF email ON "day_requests" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "donations_link_account" BEFORE INSERT OR UPDATE OF email ON "donations" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "jersey_registrations_link_account" BEFORE INSERT OR UPDATE OF email ON "jersey_registrations" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "memberships_link_account" BEFORE INSERT OR UPDATE OF email ON "memberships" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "player_absences_link_account" BEFORE INSERT OR UPDATE OF email ON "player_absences" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "session_fill_ins_link_account" BEFORE INSERT OR UPDATE OF email ON "session_fill_ins" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "waitlist_link_account" BEFORE INSERT OR UPDATE OF email ON "waitlist" FOR EACH ROW EXECUTE FUNCTION link_row_to_account();
--> statement-breakpoint
CREATE TRIGGER "players_link_rows" AFTER INSERT OR UPDATE OF email, deleted_at ON "players" FOR EACH ROW EXECUTE FUNCTION link_account_to_rows();
