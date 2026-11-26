-- Lane N (native app), Phase 5 step 6: where push notifications go.
--
-- push_devices  one row per phone or tablet that asked for notifications.
--               The device's address (its FCM token) is kept ONLY sealed
--               (encrypted by the application, bound to the person and this
--               row) plus a SHA-256 of it, so the same device is recognised
--               and can be removed without opening anything. The database,
--               its backups and its dumps never hold a usable address.
-- push_prefs    which kinds of notification a person asked for. No row, or
--               enabled = false, means "don't send": it is opt-in.
--
-- Additive: two new, empty tables. No row of any existing table changes,
-- and the app runs unchanged without them (nothing registers or sends
-- until a store app exists and PUSH_KEKS and the sender's key are set).
--
-- Platform-wide, like player_sessions: a device belongs to a person's
-- account (one Luvallplay account across clubs), not to a club, so no
-- tenant_id and no row-level security. Every query goes through the
-- signed-in person's id (apps/web/lib/push/devices.ts).
CREATE TABLE push_devices (
  id serial PRIMARY KEY,
  player_id integer NOT NULL,
  platform text NOT NULL,
  -- SHA-256 (hex) of the device's address.
  token_hash text NOT NULL,
  -- The address, encrypted by the application. Never plain text.
  sealed text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT push_devices_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT push_devices_token_hash_key UNIQUE (token_hash),
  CONSTRAINT push_devices_platform_check CHECK (platform IN ('android', 'ios')),
  CONSTRAINT push_devices_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- The sealed format (version.key-id.wrapped-key.data): a plain address can't be stored by mistake.
  CONSTRAINT push_devices_sealed_check CHECK (sealed ~ '^v1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
CREATE INDEX push_devices_player_id_idx ON push_devices (player_id);
--> statement-breakpoint
CREATE TABLE push_prefs (
  player_id integer NOT NULL,
  category text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT push_prefs_pkey PRIMARY KEY (player_id, category),
  CONSTRAINT push_prefs_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT push_prefs_category_check CHECK (category IN ('challenge', 'result', 'message', 'reminder', 'roster', 'payment'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON push_devices, push_prefs TO luvallplay_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE push_devices_id_seq TO luvallplay_app;
