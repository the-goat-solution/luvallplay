-- Phase 3 step 10: tenant_id is required, points at a real club, and every
-- club-owned table is behind row-level security (build plan §6.1, §6.6 step
-- 5; test plan §3.5).
--
-- Class: constraint (test plan §4.1). No row changes: every row already has
-- tenant_id = 1 (step 2). What changes is what the database will accept.
--
-- 1. tenant_id SET NOT NULL and a foreign key to tenants (ON DELETE RESTRICT)
--    on the 54 club-owned tables that got the column in step 2. (The 5 newer
--    tables were created with both.) The DEFAULT 1 stays until reads are
--    tenant-aware (step 11): the running app still writes without naming
--    the club.
-- 2. A role for the app, luvallplay_app: not the owner, no BYPASSRLS, no
--    login of its own. The app's connection switches to it with SET ROLE.
-- 3. Row-level security, enabled and forced, on all 59 club-owned tables,
--    with one policy: a row is visible, and may be written, only when its
--    tenant_id is the club named in the transaction setting app.tenant_id.
--    With the setting missing or empty, app_tenant_id() is NULL and nothing
--    matches: no rows, no writes. It fails closed.
--
-- The live app is not affected yet: it connects as the database owner, which
-- has BYPASSRLS (checked on a copy of production). Step 11 moves it onto the
-- app role, after seven clean days of shadow reads through these policies.
--
-- One DO block: each ALTER holds its lock for milliseconds, and the
-- runner's lock_timeout (3s) makes it fail fast, changing nothing, if a long
-- query is in the way.
CREATE FUNCTION app_tenant_id() RETURNS integer
LANGUAGE sql STABLE
AS $fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer $fn$;
--> statement-breakpoint
-- Accounts are global: when someone signs up, their earlier rows in every
-- club are linked to the account (step 3). Row-level security must not cut
-- that down to one club, so this function runs as its owner.
ALTER FUNCTION link_account_to_rows() SECURITY DEFINER SET search_path = public, pg_temp;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  IF (SELECT count(*) FROM tenants) <> 1 OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = 1 AND slug = 'three-wolves') THEN
    RAISE EXCEPTION 'expected exactly one club, three-wolves with id 1';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'luvallplay_app') THEN
    CREATE ROLE luvallplay_app NOLOGIN NOINHERIT;
  END IF;
  -- The connecting role may switch to it (SET ROLE), and nothing more.
  EXECUTE format('GRANT luvallplay_app TO %I WITH SET TRUE, INHERIT FALSE', current_user);
  GRANT USAGE ON SCHEMA public TO luvallplay_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO luvallplay_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO luvallplay_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO luvallplay_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO luvallplay_app;

  ALTER TABLE "admin_audit_log" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "admin_invites" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "api_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_after_game" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_after_game" ADD CONSTRAINT "arena_after_game_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_challenges" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_challenges" ADD CONSTRAINT "arena_challenges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_code_attempts" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_code_attempts" ADD CONSTRAINT "arena_code_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_codes" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_codes" ADD CONSTRAINT "arena_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_match_stats" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_match_stats" ADD CONSTRAINT "arena_match_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_pair_members" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_pair_members" ADD CONSTRAINT "arena_pair_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_pairs" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_pairs" ADD CONSTRAINT "arena_pairs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "arena_player_ranks" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "arena_player_ranks" ADD CONSTRAINT "arena_player_ranks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "attendance" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "bank_matches" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "bank_rules" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "bank_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "bookings" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "cancellation_feedback" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "cancellation_feedback" ADD CONSTRAINT "cancellation_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "casual_play_profiles" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "casual_play_profiles" ADD CONSTRAINT "casual_play_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "casual_play_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "casual_play_sessions" ADD CONSTRAINT "casual_play_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "club_roles" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "club_roles" ADD CONSTRAINT "club_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "club_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "club_settings" ADD CONSTRAINT "club_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "day_requests" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "day_requests" ADD CONSTRAINT "day_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "day_signup_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "day_signup_settings" ADD CONSTRAINT "day_signup_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "donations" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "donations" ADD CONSTRAINT "donations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "finance_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "finance_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "finance_sync_state" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "finance_sync_state" ADD CONSTRAINT "finance_sync_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "jersey_registrations" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "jersey_registrations" ADD CONSTRAINT "jersey_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "membership_reminders_sent" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "membership_reminders_sent" ADD CONSTRAINT "membership_reminders_sent_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "memberships" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "message_threads" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "messages" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "mini_game_draws" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "mini_game_draws" ADD CONSTRAINT "mini_game_draws_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "mini_game_scores" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "mini_game_scores" ADD CONSTRAINT "mini_game_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "player_absences" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "player_absences" ADD CONSTRAINT "player_absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "player_photos" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "player_photos" ADD CONSTRAINT "player_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "pricing_plans" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "pricing_plans" ADD CONSTRAINT "pricing_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "rr_results" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "rr_results" ADD CONSTRAINT "rr_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "session_alert_state" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "session_alert_state" ADD CONSTRAINT "session_alert_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "session_fill_ins" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "session_fill_ins" ADD CONSTRAINT "session_fill_ins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "sessions" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shop_order_items" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shop_orders" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shop_products" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shop_stock_log" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "shop_stock_log" ADD CONSTRAINT "shop_stock_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shop_variants" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "shop_variants" ADD CONSTRAINT "shop_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "stripe_payouts" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "stripe_payouts" ADD CONSTRAINT "stripe_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "waitlist" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "webhook_deliveries" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "webhook_endpoints" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wv_labels" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "wv_labels" ADD CONSTRAINT "wv_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wv_models" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "wv_models" ADD CONSTRAINT "wv_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wv_passes" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "wv_passes" ADD CONSTRAINT "wv_passes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wv_updates" ALTER COLUMN "tenant_id" SET NOT NULL;
  ALTER TABLE "wv_updates" ADD CONSTRAINT "wv_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;

  FOREACH t IN ARRAY ARRAY['admin_audit_log', 'admin_invites', 'api_tokens', 'arena_after_game', 'arena_challenges', 'arena_code_attempts', 'arena_codes', 'arena_match_stats', 'arena_pair_members', 'arena_pairs', 'arena_player_ranks', 'attendance', 'bank_matches', 'bank_rules', 'bank_transactions', 'bookings', 'cancellation_feedback', 'casual_play_profiles', 'casual_play_sessions', 'club_members', 'club_plans', 'club_roles', 'club_settings', 'day_requests', 'day_signup_settings', 'donations', 'finance_entries', 'finance_settings', 'finance_sync_state', 'jersey_registrations', 'junior_profiles', 'membership_reminders_sent', 'memberships', 'message_threads', 'messages', 'mini_game_draws', 'mini_game_scores', 'player_absences', 'player_photos', 'pricing_plans', 'rr_results', 'session_alert_state', 'session_fill_ins', 'sessions', 'shop_order_items', 'shop_orders', 'shop_products', 'shop_stock_log', 'shop_variants', 'stripe_payouts', 'tenant_modules', 'usage_counters', 'waitlist', 'webhook_deliveries', 'webhook_endpoints', 'wv_labels', 'wv_models', 'wv_passes', 'wv_updates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
