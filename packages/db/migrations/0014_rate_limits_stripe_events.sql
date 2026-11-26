-- Lane H (hardening), audit H6 and H3: two small platform tables.
--
-- rate_limits    one counter per limited thing (a sign-in address, a player's
--                action), so a limit is the same on every server instance.
--                Until now each instance kept its own count in memory, so a
--                limit of 10 was 10 per instance. The key is stored hashed:
--                no IP address or email is kept here.
-- stripe_events  the id of every Stripe event that was handled to the end,
--                so an event Stripe delivers again is recognised and skipped.
--
-- Additive: two new, empty tables. No row of any existing table changes,
-- and the app runs unchanged without them (the limiter stays in memory
-- until RATE_LIMIT_STORE=database is set; the webhook handles an event as
-- before when the table isn't there).
--
-- Platform-wide, like auth_codes and sms_sends: neither holds a club's
-- data, so no tenant_id and no row-level security. The app's role gets the
-- same rights as on the other platform tables.
CREATE TABLE rate_limits (
  key_hash text PRIMARY KEY NOT NULL,
  count integer NOT NULL,
  reset_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX rate_limits_reset_at_idx ON rate_limits (reset_at);
--> statement-breakpoint
CREATE TABLE stripe_events (
  event_id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  processed_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX stripe_events_processed_at_idx ON stripe_events (processed_at);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits, stripe_events TO luvallplay_app;
