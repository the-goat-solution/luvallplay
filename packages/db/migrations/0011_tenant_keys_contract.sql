-- Phase 3 step 11, preparation: the old single-club keys go (contract).
--
-- Migration 0010 added a unique index starting with tenant_id beside each
-- natural key that assumed one club, and the app (since #114) names those in
-- its upserts. This removes the old keys and gives the per-club ones their
-- names, so every key, and every name the app checks, reads as before with
-- the club in front:
--
--   - five unique indexes: the old one is dropped, the per-club one takes
--     its name;
--   - two unique constraints and thirteen primary keys: the same, reusing
--     the index built in 0010 (no new index build);
--   - the two foreign keys to a play day (bookings, session_alert_state)
--     now carry the club too: a booking can only point at its own club's day.
--
-- No row changes. Every statement is a catalogue change except the two
-- foreign keys, which check their (small) tables once. The app version
-- before #114 names the old keys and would fail after this; #114 or later
-- must be live first.
DROP INDEX admin_invites_one_pending;
--> statement-breakpoint
ALTER INDEX admin_invites_one_pending_tenant RENAME TO admin_invites_one_pending;
--> statement-breakpoint
DROP INDEX arena_pair_members_one_active;
--> statement-breakpoint
ALTER INDEX arena_pair_members_one_active_tenant RENAME TO arena_pair_members_one_active;
--> statement-breakpoint
DROP INDEX day_requests_pending_idx;
--> statement-breakpoint
ALTER INDEX day_requests_pending_tenant_idx RENAME TO day_requests_pending_idx;
--> statement-breakpoint
DROP INDEX jersey_one_per_email;
--> statement-breakpoint
ALTER INDEX jersey_one_per_email_tenant RENAME TO jersey_one_per_email;
--> statement-breakpoint
DROP INDEX mini_game_draws_one_active;
--> statement-breakpoint
ALTER INDEX mini_game_draws_one_active_tenant RENAME TO mini_game_draws_one_active;
--> statement-breakpoint
ALTER TABLE bank_rules DROP CONSTRAINT bank_rules_pattern_direction_key, ADD CONSTRAINT bank_rules_pattern_direction_key UNIQUE USING INDEX bank_rules_tenant_key;
--> statement-breakpoint
ALTER TABLE shop_products DROP CONSTRAINT shop_products_slug_key, ADD CONSTRAINT shop_products_slug_key UNIQUE USING INDEX shop_products_tenant_key;
--> statement-breakpoint
ALTER TABLE bookings DROP CONSTRAINT bookings_session_date_fkey;
--> statement-breakpoint
ALTER TABLE session_alert_state DROP CONSTRAINT session_alert_state_session_date_fkey;
--> statement-breakpoint
ALTER TABLE arena_player_ranks DROP CONSTRAINT arena_player_ranks_pkey, ADD CONSTRAINT arena_player_ranks_pkey PRIMARY KEY USING INDEX arena_player_ranks_tenant_key;
--> statement-breakpoint
ALTER TABLE attendance DROP CONSTRAINT attendance_pkey, ADD CONSTRAINT attendance_pkey PRIMARY KEY USING INDEX attendance_tenant_key;
--> statement-breakpoint
ALTER TABLE casual_play_profiles DROP CONSTRAINT casual_play_profiles_pkey, ADD CONSTRAINT casual_play_profiles_pkey PRIMARY KEY USING INDEX casual_play_profiles_tenant_key;
--> statement-breakpoint
ALTER TABLE casual_play_sessions DROP CONSTRAINT casual_play_sessions_pkey, ADD CONSTRAINT casual_play_sessions_pkey PRIMARY KEY USING INDEX casual_play_sessions_tenant_key;
--> statement-breakpoint
ALTER TABLE club_roles DROP CONSTRAINT club_roles_pkey, ADD CONSTRAINT club_roles_pkey PRIMARY KEY USING INDEX club_roles_tenant_key;
--> statement-breakpoint
ALTER TABLE club_settings DROP CONSTRAINT club_settings_pkey, ADD CONSTRAINT club_settings_pkey PRIMARY KEY USING INDEX club_settings_tenant_key;
--> statement-breakpoint
ALTER TABLE day_signup_settings DROP CONSTRAINT day_signup_settings_pkey, ADD CONSTRAINT day_signup_settings_pkey PRIMARY KEY USING INDEX day_signup_settings_tenant_key;
--> statement-breakpoint
ALTER TABLE finance_settings DROP CONSTRAINT finance_settings_pkey, ADD CONSTRAINT finance_settings_pkey PRIMARY KEY USING INDEX finance_settings_tenant_key;
--> statement-breakpoint
ALTER TABLE finance_sync_state DROP CONSTRAINT finance_sync_state_pkey, ADD CONSTRAINT finance_sync_state_pkey PRIMARY KEY USING INDEX finance_sync_state_tenant_key;
--> statement-breakpoint
ALTER TABLE player_absences DROP CONSTRAINT player_absences_pkey, ADD CONSTRAINT player_absences_pkey PRIMARY KEY USING INDEX player_absences_tenant_key;
--> statement-breakpoint
ALTER TABLE pricing_plans DROP CONSTRAINT pricing_plans_pkey, ADD CONSTRAINT pricing_plans_pkey PRIMARY KEY USING INDEX pricing_plans_tenant_key;
--> statement-breakpoint
ALTER TABLE session_alert_state DROP CONSTRAINT session_alert_state_pkey, ADD CONSTRAINT session_alert_state_pkey PRIMARY KEY USING INDEX session_alert_state_tenant_key;
--> statement-breakpoint
ALTER TABLE sessions DROP CONSTRAINT sessions_pkey, ADD CONSTRAINT sessions_pkey PRIMARY KEY USING INDEX sessions_tenant_key;
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT bookings_session_date_fkey FOREIGN KEY (tenant_id, session_date) REFERENCES sessions (tenant_id, date);
--> statement-breakpoint
ALTER TABLE session_alert_state ADD CONSTRAINT session_alert_state_session_date_fkey FOREIGN KEY (tenant_id, session_date) REFERENCES sessions (tenant_id, date);
