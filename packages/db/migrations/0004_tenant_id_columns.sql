-- Phase 3 step 2: tenant_id on every club-owned table (build plan §6.1,
-- §6.6 steps 2 and 3).
--
-- Class: additive (test plan §4.1). One new nullable column on 54 tables.
-- No existing value changes.
--
-- The column has a constant DEFAULT: Three Wolves, the only club. Postgres
-- stores a constant default in the catalog, so:
-- - nothing is rewritten: each ALTER is a catalog change that takes
--   milliseconds;
-- - every existing row reads as Three Wolves' straight away, so the backfill
--   is part of the same atomic change and there are no half-filled tables;
-- - rows written afterwards get it too, from the current app version AND the
--   previous one (which doesn't know the column). That is what keeps an app
--   rollback safe (test plan §0 rule 3).
-- The default is a transition device. Step 10 makes the column NOT NULL with
-- a foreign key and row-level security, and the default is dropped before a
-- second club can exist (scripts/tenants/verify.mjs fails if there is more
-- than one club while the defaults are in place).
--
-- One DO block, so the whole change is one round trip: the brief ACCESS
-- EXCLUSIVE lock each ALTER takes is held for milliseconds, not for the
-- duration of 54 network calls. The runner's lock_timeout (3s) makes it fail
-- fast, changing nothing, if a long query is in the way.
--
-- Not included, because they belong to the platform, not to a club:
-- players, player_sessions, auth_codes, sms_sends, player_settings (the SMS
-- switches), player_events, platform_admins, admin_handoffs, guardianships,
-- schema_runs (unused) and the unused pv_* preview tables.
DO $$
BEGIN
  IF (SELECT count(*) FROM tenants) <> 1 OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = 1 AND slug = 'three-wolves') THEN
    RAISE EXCEPTION 'expected exactly one club, three-wolves with id 1: the tenant_id default would be wrong';
  END IF;
  ALTER TABLE "admin_audit_log" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "admin_invites" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "api_tokens" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_after_game" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_challenges" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_code_attempts" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_codes" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_match_stats" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_pair_members" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_pairs" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "arena_player_ranks" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "attendance" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "bank_matches" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "bank_rules" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "bank_transactions" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "bookings" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "cancellation_feedback" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "casual_play_profiles" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "casual_play_sessions" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "club_roles" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "club_settings" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "day_requests" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "day_signup_settings" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "donations" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "finance_entries" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "finance_settings" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "finance_sync_state" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "jersey_registrations" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "membership_reminders_sent" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "memberships" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "message_threads" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "messages" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "mini_game_draws" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "mini_game_scores" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "player_absences" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "player_photos" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "pricing_plans" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "rr_results" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "session_alert_state" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "session_fill_ins" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "sessions" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "shop_order_items" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "shop_orders" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "shop_products" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "shop_stock_log" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "shop_variants" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "stripe_payouts" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "waitlist" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "webhook_deliveries" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "webhook_endpoints" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "wv_labels" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "wv_models" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "wv_passes" ADD COLUMN "tenant_id" integer DEFAULT 1;
  ALTER TABLE "wv_updates" ADD COLUMN "tenant_id" integer DEFAULT 1;
END $$;
