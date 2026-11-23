-- Phase 2 PR 4: account foreign keys ON DELETE CASCADE / SET NULL → RESTRICT
-- (test plan §4.2, §4.5).
--
-- Class: schema-only, identity-adjacent (test plan §4.1). No rows change.
-- Accounts are only ever soft-deleted (deletePlayerAccount sets deleted_at and
-- anonymises); nothing in the app deletes a players row. Today one accidental
-- DELETE FROM players would silently wipe that person's sessions, photos,
-- messages, events, API keys and webhooks (CASCADE) and detach their shop
-- orders and feedback (SET NULL). With RESTRICT that DELETE fails instead.
--
-- Each constraint keeps its name. Swapped per table in one statement, added
-- NOT VALID (no full-table check under the stronger lock), then validated
-- (a lighter lock that doesn't block reads or writes). The runner wraps the
-- whole file in one transaction with lock_timeout 3s: it applies completely
-- or not at all.
--
-- Rehearse: npm run data-guard -- rehearse --expect scripts/data-guard/expectations/2026-11-phase2-account-fks-restrict.json --run "node scripts/db/migrate.mjs"
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
-- api_tokens.player_id: CASCADE → RESTRICT
ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_player_id_fkey, ADD CONSTRAINT api_tokens_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- cancellation_feedback.player_id: SET NULL → RESTRICT
ALTER TABLE cancellation_feedback DROP CONSTRAINT cancellation_feedback_player_id_fkey, ADD CONSTRAINT cancellation_feedback_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- message_threads.player_id: CASCADE → RESTRICT
ALTER TABLE message_threads DROP CONSTRAINT message_threads_player_id_fkey, ADD CONSTRAINT message_threads_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- player_events.player_id: CASCADE → RESTRICT
ALTER TABLE player_events DROP CONSTRAINT player_events_player_id_fkey, ADD CONSTRAINT player_events_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- player_photos.player_id: CASCADE → RESTRICT
ALTER TABLE player_photos DROP CONSTRAINT player_photos_player_id_fkey, ADD CONSTRAINT player_photos_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- player_sessions.player_id: CASCADE → RESTRICT
ALTER TABLE player_sessions DROP CONSTRAINT player_sessions_player_id_fkey, ADD CONSTRAINT player_sessions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- shop_orders.player_id: SET NULL → RESTRICT
ALTER TABLE shop_orders DROP CONSTRAINT shop_orders_player_id_fkey, ADD CONSTRAINT shop_orders_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
-- webhook_endpoints.player_id: CASCADE → RESTRICT
ALTER TABLE webhook_endpoints DROP CONSTRAINT webhook_endpoints_player_id_fkey, ADD CONSTRAINT webhook_endpoints_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE api_tokens VALIDATE CONSTRAINT api_tokens_player_id_fkey;
--> statement-breakpoint
ALTER TABLE cancellation_feedback VALIDATE CONSTRAINT cancellation_feedback_player_id_fkey;
--> statement-breakpoint
ALTER TABLE message_threads VALIDATE CONSTRAINT message_threads_player_id_fkey;
--> statement-breakpoint
ALTER TABLE player_events VALIDATE CONSTRAINT player_events_player_id_fkey;
--> statement-breakpoint
ALTER TABLE player_photos VALIDATE CONSTRAINT player_photos_player_id_fkey;
--> statement-breakpoint
ALTER TABLE player_sessions VALIDATE CONSTRAINT player_sessions_player_id_fkey;
--> statement-breakpoint
ALTER TABLE shop_orders VALIDATE CONSTRAINT shop_orders_player_id_fkey;
--> statement-breakpoint
ALTER TABLE webhook_endpoints VALIDATE CONSTRAINT webhook_endpoints_player_id_fkey;
