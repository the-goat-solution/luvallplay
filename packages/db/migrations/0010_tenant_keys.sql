-- Phase 3 step 11, preparation: keys and defaults that know about the club
-- (build plan §6.1, runbook §11). Expand only: nothing is dropped, so the
-- running app version is unaffected.
--
-- 1. tenant_id's default follows the club the transaction is scoped to.
--    As the database owner (how the app connects today) no club is named and
--    the default is still 1, Three Wolves, exactly as before. Under
--    TENANT_SCOPE=enforce an insert that doesn't name the club gets the
--    request's club, where a fixed 1 would be refused by row-level security
--    for any other club.
--
-- 2. Natural keys that assumed one club get a second unique index that
--    starts with tenant_id. The old keys stay until the app no longer names
--    them in ON CONFLICT (they are dropped in a later, separate step). With
--    one club the two say the same thing.
--
-- Metadata changes and small index builds (the largest table has a few
-- thousand rows); the runner's lock_timeout makes it fail fast if blocked.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_audit_log',
    'admin_invites',
    'api_tokens',
    'arena_after_game',
    'arena_challenges',
    'arena_code_attempts',
    'arena_codes',
    'arena_match_stats',
    'arena_pair_members',
    'arena_pairs',
    'arena_player_ranks',
    'attendance',
    'bank_matches',
    'bank_rules',
    'bank_transactions',
    'bookings',
    'cancellation_feedback',
    'casual_play_profiles',
    'casual_play_sessions',
    'club_roles',
    'club_settings',
    'day_requests',
    'day_signup_settings',
    'donations',
    'finance_entries',
    'finance_settings',
    'finance_sync_state',
    'jersey_registrations',
    'membership_reminders_sent',
    'memberships',
    'message_threads',
    'messages',
    'mini_game_draws',
    'mini_game_scores',
    'player_absences',
    'player_photos',
    'pricing_plans',
    'rr_results',
    'session_alert_state',
    'session_fill_ins',
    'sessions',
    'shop_order_items',
    'shop_orders',
    'shop_products',
    'shop_stock_log',
    'shop_variants',
    'stripe_payouts',
    'waitlist',
    'webhook_deliveries',
    'webhook_endpoints',
    'wv_labels',
    'wv_models',
    'wv_passes',
    'wv_updates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT COALESCE(app_tenant_id(), 1)', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX admin_invites_one_pending_tenant ON admin_invites (tenant_id, email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX arena_pair_members_one_active_tenant ON arena_pair_members (tenant_id, player_id) WHERE active;
--> statement-breakpoint
CREATE UNIQUE INDEX arena_player_ranks_tenant_key ON arena_player_ranks (tenant_id, player_id);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_tenant_key ON attendance (tenant_id, session_date, email);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_rules_tenant_key ON bank_rules (tenant_id, pattern, direction);
--> statement-breakpoint
CREATE UNIQUE INDEX casual_play_profiles_tenant_key ON casual_play_profiles (tenant_id, email);
--> statement-breakpoint
CREATE UNIQUE INDEX casual_play_sessions_tenant_key ON casual_play_sessions (tenant_id, date);
--> statement-breakpoint
CREATE UNIQUE INDEX club_roles_tenant_key ON club_roles (tenant_id, player_id);
--> statement-breakpoint
CREATE UNIQUE INDEX club_settings_tenant_key ON club_settings (tenant_id, key);
--> statement-breakpoint
CREATE UNIQUE INDEX day_requests_pending_tenant_idx ON day_requests (tenant_id, day, lower(email)) WHERE (notified_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX day_signup_settings_tenant_key ON day_signup_settings (tenant_id, day);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_settings_tenant_key ON finance_settings (tenant_id, key);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_sync_state_tenant_key ON finance_sync_state (tenant_id, key);
--> statement-breakpoint
CREATE UNIQUE INDEX jersey_one_per_email_tenant ON jersey_registrations (tenant_id, email_normalized) WHERE (status = ANY (ARRAY['pending'::text, 'paid'::text]));
--> statement-breakpoint
CREATE UNIQUE INDEX mini_game_draws_one_active_tenant ON mini_game_draws (tenant_id) WHERE (archived_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX player_absences_tenant_key ON player_absences (tenant_id, session_date, email);
--> statement-breakpoint
CREATE UNIQUE INDEX pricing_plans_tenant_key ON pricing_plans (tenant_id, plan_id);
--> statement-breakpoint
CREATE UNIQUE INDEX session_alert_state_tenant_key ON session_alert_state (tenant_id, session_date);
--> statement-breakpoint
CREATE UNIQUE INDEX sessions_tenant_key ON sessions (tenant_id, date);
--> statement-breakpoint
CREATE UNIQUE INDEX shop_products_tenant_key ON shop_products (tenant_id, slug);
