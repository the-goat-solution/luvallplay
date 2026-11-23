-- Baseline: the production schema as of the Phase 2 start (Nov 2026),
-- generated from docs/schema/production-2026-11.sql by
-- scripts/db/baseline-from-dump.mjs. Production is marked as already at
-- this migration (npm run db:migrate -- --baseline); it only runs on empty
-- databases (CI, local, new environments).

SET lock_timeout = '3s';
SET statement_timeout = '120s';
--> statement-breakpoint
CREATE SEQUENCE admin_audit_log_id_seq AS bigint;
CREATE SEQUENCE admin_handoffs_id_seq AS integer;
CREATE SEQUENCE admin_invites_id_seq AS integer;
CREATE SEQUENCE api_tokens_id_seq AS integer;
CREATE SEQUENCE arena_challenges_id_seq AS integer;
CREATE SEQUENCE arena_codes_id_seq AS integer;
CREATE SEQUENCE arena_pairs_id_seq AS integer;
CREATE SEQUENCE auth_codes_id_seq AS integer;
CREATE SEQUENCE bank_rules_id_seq AS integer;
CREATE SEQUENCE bank_transactions_id_seq AS integer;
CREATE SEQUENCE bookings_id_seq AS integer;
CREATE SEQUENCE cancellation_feedback_id_seq AS integer;
CREATE SEQUENCE day_requests_id_seq AS integer;
CREATE SEQUENCE donations_id_seq AS integer;
CREATE SEQUENCE finance_entries_id_seq AS integer;
CREATE SEQUENCE jersey_registrations_id_seq AS integer;
CREATE SEQUENCE memberships_id_seq AS integer;
CREATE SEQUENCE message_threads_id_seq AS integer;
CREATE SEQUENCE messages_id_seq AS integer;
CREATE SEQUENCE mini_game_draws_id_seq AS integer;
CREATE SEQUENCE player_events_id_seq AS integer;
CREATE SEQUENCE player_photos_id_seq AS integer;
CREATE SEQUENCE player_sessions_id_seq AS integer;
CREATE SEQUENCE players_id_seq AS integer;
CREATE SEQUENCE pv_arena_challenges_id_seq AS integer;
CREATE SEQUENCE pv_arena_codes_id_seq AS integer;
CREATE SEQUENCE pv_arena_pairs_id_seq AS integer;
CREATE SEQUENCE pv_wv_labels_id_seq AS integer;
CREATE SEQUENCE pv_wv_models_id_seq AS integer;
CREATE SEQUENCE pv_wv_passes_id_seq AS integer;
CREATE SEQUENCE pv_wv_updates_id_seq AS integer;
CREATE SEQUENCE session_fill_ins_id_seq AS integer;
CREATE SEQUENCE shop_order_items_id_seq AS integer;
CREATE SEQUENCE shop_orders_id_seq AS integer;
CREATE SEQUENCE shop_products_id_seq AS integer;
CREATE SEQUENCE shop_stock_log_id_seq AS integer;
CREATE SEQUENCE shop_variants_id_seq AS integer;
CREATE SEQUENCE sms_sends_id_seq AS integer;
CREATE SEQUENCE waitlist_id_seq AS integer;
CREATE SEQUENCE webhook_deliveries_id_seq AS integer;
CREATE SEQUENCE webhook_endpoints_id_seq AS integer;
CREATE SEQUENCE wv_labels_id_seq AS integer;
CREATE SEQUENCE wv_models_id_seq AS integer;
CREATE SEQUENCE wv_passes_id_seq AS integer;
CREATE SEQUENCE wv_updates_id_seq AS integer;
--> statement-breakpoint
CREATE TABLE admin_audit_log (
  id bigint DEFAULT nextval('admin_audit_log_id_seq'::regclass) NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  actor_player_id integer,
  actor_kind text NOT NULL,
  action text NOT NULL,
  target text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT admin_audit_log_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['player'::text, 'break-glass'::text, 'script'::text, 'system'::text]))),
  CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE admin_handoffs (
  id integer DEFAULT nextval('admin_handoffs_id_seq'::regclass) NOT NULL,
  token_hash text NOT NULL,
  player_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  CONSTRAINT admin_handoffs_pkey PRIMARY KEY (id),
  CONSTRAINT admin_handoffs_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE admin_invites (
  id integer DEFAULT nextval('admin_invites_id_seq'::regclass) NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  invited_by integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_at timestamp with time zone,
  accepted_player_id integer,
  revoked_at timestamp with time zone,
  CONSTRAINT admin_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text]))),
  CONSTRAINT admin_invites_pkey PRIMARY KEY (id)
);

CREATE TABLE api_tokens (
  id integer DEFAULT nextval('api_tokens_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL,
  token_hash text NOT NULL,
  prefix text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT api_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE arena_after_game (
  challenge_id integer NOT NULL,
  player_id integer NOT NULL,
  keep_pair boolean,
  again boolean,
  answered_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT arena_after_game_pkey PRIMARY KEY (challenge_id, player_id)
);

CREATE TABLE arena_challenges (
  id integer DEFAULT nextval('arena_challenges_id_seq'::regclass) NOT NULL,
  posting_pair integer NOT NULL,
  p1 integer NOT NULL,
  p2 integer NOT NULL,
  accepting_pair integer,
  a1 integer,
  a2 integer,
  note text,
  status text DEFAULT 'open'::text NOT NULL,
  available_until timestamp with time zone NOT NULL,
  posted_by integer NOT NULL,
  posted_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_by integer,
  accepted_at timestamp with time zone,
  called_off_by integer,
  checked_in_at timestamp with time zone,
  played_on date,
  score_posting integer,
  score_accepting integer,
  retired_by text,
  entered_by integer,
  entered_at timestamp with time zone,
  confirmed_by integer,
  auto_confirmed boolean DEFAULT false NOT NULL,
  disputed_by integer,
  disputed_at timestamp with time zone,
  dispute_note text,
  resolved_by_admin boolean DEFAULT false NOT NULL,
  completed_at timestamp with time zone,
  void_reason text,
  CONSTRAINT arena_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE arena_code_attempts (
  player_id integer NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE arena_codes (
  id integer DEFAULT nextval('arena_codes_id_seq'::regclass) NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  owner_id integer NOT NULL,
  challenge_id integer,
  status text DEFAULT 'live'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_by integer,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT arena_codes_pkey PRIMARY KEY (id)
);

CREATE TABLE arena_match_stats (
  challenge_id integer NOT NULL,
  recorded_by integer NOT NULL,
  stats jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'final'::text NOT NULL,
  live jsonb,
  live_at timestamp with time zone,
  CONSTRAINT arena_match_stats_pkey PRIMARY KEY (challenge_id)
);

CREATE TABLE arena_pair_members (
  pair_id integer NOT NULL,
  player_id integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  CONSTRAINT arena_pair_members_pkey PRIMARY KEY (pair_id, player_id)
);

CREATE TABLE arena_pairs (
  id integer DEFAULT nextval('arena_pairs_id_seq'::regclass) NOT NULL,
  player_low integer NOT NULL,
  player_high integer NOT NULL,
  name text,
  formed_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  ended_reason text,
  CONSTRAINT arena_pairs_pkey PRIMARY KEY (id)
);

CREATE TABLE arena_player_ranks (
  player_id integer NOT NULL,
  seen_index integer DEFAULT 0 NOT NULL,
  peak_index integer DEFAULT 0 NOT NULL,
  was_tarnished boolean DEFAULT false NOT NULL,
  polished_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT arena_player_ranks_pkey PRIMARY KEY (player_id)
);

CREATE TABLE attendance (
  session_date date NOT NULL,
  email text NOT NULL,
  source text NOT NULL,
  verified boolean DEFAULT true NOT NULL,
  removed boolean DEFAULT false NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT attendance_pkey PRIMARY KEY (session_date, email)
);

CREATE TABLE auth_codes (
  id integer DEFAULT nextval('auth_codes_id_seq'::regclass) NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  link_token_hash text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  ip_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT auth_codes_pkey PRIMARY KEY (id),
  CONSTRAINT auth_codes_link_token_hash_key UNIQUE (link_token_hash)
);

CREATE TABLE bank_matches (
  bank_txn_id integer NOT NULL,
  entry_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT bank_matches_pkey PRIMARY KEY (bank_txn_id, entry_id),
  CONSTRAINT bank_matches_entry_id_key UNIQUE (entry_id)
);

CREATE TABLE bank_rules (
  id integer DEFAULT nextval('bank_rules_id_seq'::regclass) NOT NULL,
  pattern text NOT NULL,
  direction text NOT NULL,
  action text NOT NULL,
  status text,
  category text,
  name text,
  method text,
  person text,
  auto boolean DEFAULT false NOT NULL,
  hits integer DEFAULT 0 NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT bank_rules_action_check CHECK ((action = ANY (ARRAY['create'::text, 'classify'::text]))),
  CONSTRAINT bank_rules_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
  CONSTRAINT bank_rules_pkey PRIMARY KEY (id),
  CONSTRAINT bank_rules_pattern_direction_key UNIQUE (pattern, direction)
);

CREATE TABLE bank_transactions (
  id integer DEFAULT nextval('bank_transactions_id_seq'::regclass) NOT NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  account text,
  txn_date date NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  reference text,
  amount_cents bigint NOT NULL,
  balance_cents bigint,
  status text DEFAULT 'unmatched'::text NOT NULL,
  entry_id integer,
  payout_id text,
  auto_matched boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  match_reason text,
  CONSTRAINT bank_transactions_status_check CHECK ((status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'stripe_payout'::text, 'cash_deposit'::text, 'cash_withdrawal'::text, 'internal'::text, 'ignored'::text]))),
  CONSTRAINT bank_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT bank_transactions_entry_id_key UNIQUE (entry_id),
  CONSTRAINT bank_transactions_external_id_key UNIQUE (external_id)
);

CREATE TABLE bookings (
  id integer DEFAULT nextval('bookings_id_seq'::regclass) NOT NULL,
  session_date date NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  payment_intent_id text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reminder_sent_at timestamp with time zone,
  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_payment_intent_id_key UNIQUE (payment_intent_id)
);

CREATE TABLE cancellation_feedback (
  id integer DEFAULT nextval('cancellation_feedback_id_seq'::regclass) NOT NULL,
  player_id integer,
  membership_id integer,
  action text NOT NULL,
  reason text NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cancellation_feedback_pkey PRIMARY KEY (id)
);

CREATE TABLE casual_play_profiles (
  email text NOT NULL,
  tier smallint,
  nickname text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT casual_play_profiles_pkey PRIMARY KEY (email)
);

CREATE TABLE casual_play_sessions (
  date date NOT NULL,
  state jsonb NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT casual_play_sessions_pkey PRIMARY KEY (date)
);

CREATE TABLE club_roles (
  player_id integer NOT NULL,
  role text NOT NULL,
  granted_by integer,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT club_roles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text]))),
  CONSTRAINT club_roles_pkey PRIMARY KEY (player_id)
);

CREATE TABLE day_requests (
  id integer DEFAULT nextval('day_requests_id_seq'::regclass) NOT NULL,
  day text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  notified_at timestamp with time zone,
  CONSTRAINT day_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE day_signup_settings (
  day text NOT NULL,
  paused boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT day_signup_settings_pkey PRIMARY KEY (day)
);

CREATE TABLE donations (
  id integer DEFAULT nextval('donations_id_seq'::regclass) NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  amount_cents integer NOT NULL,
  frequency text DEFAULT 'once'::text NOT NULL,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT donations_pkey PRIMARY KEY (id),
  CONSTRAINT donations_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id),
  CONSTRAINT donations_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
);

CREATE TABLE finance_entries (
  id integer DEFAULT nextval('finance_entries_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  method text,
  person text,
  entry_date date NOT NULL,
  amount_cents bigint NOT NULL,
  notes text,
  origin text DEFAULT 'manual'::text NOT NULL,
  external_id text,
  external_url text,
  receipt_url text,
  receipt_access text,
  receipt_content_type text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT finance_entries_amount_cents_check CHECK ((amount_cents > 0)),
  CONSTRAINT finance_entries_kind_check CHECK ((kind = ANY (ARRAY['received'::text, 'spent'::text]))),
  CONSTRAINT finance_entries_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'stripe'::text]))),
  CONSTRAINT finance_entries_pkey PRIMARY KEY (id),
  CONSTRAINT finance_entries_external_id_key UNIQUE (external_id)
);

CREATE TABLE finance_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT finance_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE finance_sync_state (
  key text NOT NULL,
  last_started_at timestamp with time zone,
  last_finished_at timestamp with time zone,
  last_error text,
  CONSTRAINT finance_sync_state_pkey PRIMARY KEY (key)
);

CREATE TABLE jersey_registrations (
  id integer DEFAULT nextval('jersey_registrations_id_seq'::regclass) NOT NULL,
  ref_code text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  phone text NOT NULL,
  phone_normalized text NOT NULL,
  name_normalized text NOT NULL,
  size text NOT NULL,
  print_name text,
  print_number integer,
  price_cents integer NOT NULL,
  early_bird boolean NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  paid_cents integer,
  paid_at timestamp with time zone,
  paid_by text,
  bank_txn_id integer,
  entry_id integer,
  ip_hash text,
  device_id text,
  flags text[] DEFAULT '{}'::text[] NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  lang text DEFAULT 'en'::text NOT NULL,
  print_country text,
  CONSTRAINT jersey_registrations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'released'::text, 'cancelled'::text]))),
  CONSTRAINT jersey_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT jersey_registrations_ref_code_key UNIQUE (ref_code)
);

CREATE TABLE membership_reminders_sent (
  membership_id integer NOT NULL,
  session_date date NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT membership_reminders_sent_pkey PRIMARY KEY (membership_id, session_date)
);

CREATE TABLE memberships (
  id integer DEFAULT nextval('memberships_id_seq'::regclass) NOT NULL,
  email text NOT NULL,
  plan text NOT NULL,
  stripe_subscription_id text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  first_name text,
  last_name text,
  phone text,
  period_start date,
  period_end date,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  recurring boolean DEFAULT true NOT NULL,
  stripe_payment_intent_id text,
  last_renewal_invoice_id text,
  day text DEFAULT 'friday'::text NOT NULL,
  renewal_token text,
  renewal_reminder_sent_at timestamp with time zone,
  renewal_of integer,
  free_days_granted integer DEFAULT 0 NOT NULL,
  CONSTRAINT memberships_pkey PRIMARY KEY (id),
  CONSTRAINT memberships_renewal_token_key UNIQUE (renewal_token),
  CONSTRAINT memberships_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id),
  CONSTRAINT memberships_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
);

CREATE TABLE message_threads (
  id integer DEFAULT nextval('message_threads_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  subject text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  started_by text DEFAULT 'player'::text NOT NULL,
  last_message_at timestamp with time zone DEFAULT now() NOT NULL,
  unread_for_admin boolean DEFAULT false NOT NULL,
  unread_for_player boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
  CONSTRAINT message_threads_pkey PRIMARY KEY (id)
);

CREATE TABLE messages (
  id integer DEFAULT nextval('messages_id_seq'::regclass) NOT NULL,
  thread_id integer NOT NULL,
  sender text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT messages_sender_check CHECK ((sender = ANY (ARRAY['player'::text, 'admin'::text]))),
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);

CREATE TABLE mini_game_draws (
  id integer DEFAULT nextval('mini_game_draws_id_seq'::regclass) NOT NULL,
  teams jsonb NOT NULL,
  matches jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_until timestamp with time zone NOT NULL,
  archived_at timestamp with time zone,
  CONSTRAINT mini_game_draws_pkey PRIMARY KEY (id)
);

CREATE TABLE mini_game_scores (
  draw_id integer NOT NULL,
  match_id text NOT NULL,
  score_a integer NOT NULL,
  score_b integer NOT NULL,
  locked_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT mini_game_scores_pkey PRIMARY KEY (draw_id, match_id)
);

CREATE TABLE platform_admins (
  player_id integer NOT NULL,
  granted_by integer,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT platform_admins_pkey PRIMARY KEY (player_id)
);

CREATE TABLE player_absences (
  session_date date NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT player_absences_pkey PRIMARY KEY (session_date, email)
);

CREATE TABLE player_events (
  id integer DEFAULT nextval('player_events_id_seq'::regclass) NOT NULL,
  player_id integer,
  event text NOT NULL,
  detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT player_events_pkey PRIMARY KEY (id)
);

CREATE TABLE player_photos (
  id integer DEFAULT nextval('player_photos_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  original_url text NOT NULL,
  display_url text NOT NULL,
  thumb_url text NOT NULL,
  width integer,
  height integer,
  bytes bigint DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  safesearch jsonb,
  caption text,
  featured boolean DEFAULT false NOT NULL,
  consent_at timestamp with time zone NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT player_photos_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'needs_review'::text, 'rejected'::text, 'hidden'::text]))),
  CONSTRAINT player_photos_pkey PRIMARY KEY (id)
);

CREATE TABLE player_sessions (
  id integer DEFAULT nextval('player_sessions_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  token_hash text NOT NULL,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT player_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT player_sessions_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE player_settings (
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT player_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE players (
  id integer DEFAULT nextval('players_id_seq'::regclass) NOT NULL,
  email text NOT NULL,
  first_name text DEFAULT ''::text NOT NULL,
  last_name text DEFAULT ''::text NOT NULL,
  display_name text,
  phone text,
  phone_e164 text,
  phone_verified_at timestamp with time zone,
  lang text DEFAULT 'en'::text NOT NULL,
  stripe_customer_id text,
  leaderboard_visible boolean DEFAULT true NOT NULL,
  minigame_name text,
  avatar_url text,
  created_via text DEFAULT 'signup'::text NOT NULL,
  claimed_at timestamp with time zone,
  welcome_sent_at timestamp with time zone,
  welcome_card_dismissed_at timestamp with time zone,
  install_hint_shown_at timestamp with time zone,
  installed_at timestamp with time zone,
  leaderboard_optout_token text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT players_pkey PRIMARY KEY (id),
  CONSTRAINT players_email_key UNIQUE (email),
  CONSTRAINT players_leaderboard_optout_token_key UNIQUE (leaderboard_optout_token)
);

CREATE TABLE pv_arena_after_game (
  challenge_id integer NOT NULL,
  player_id integer NOT NULL,
  keep_pair boolean,
  again boolean,
  answered_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_arena_after_game_pkey PRIMARY KEY (challenge_id, player_id)
);

CREATE TABLE pv_arena_challenges (
  id integer DEFAULT nextval('pv_arena_challenges_id_seq'::regclass) NOT NULL,
  posting_pair integer NOT NULL,
  p1 integer NOT NULL,
  p2 integer NOT NULL,
  accepting_pair integer,
  a1 integer,
  a2 integer,
  note text,
  status text DEFAULT 'open'::text NOT NULL,
  available_until timestamp with time zone NOT NULL,
  posted_by integer NOT NULL,
  posted_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_by integer,
  accepted_at timestamp with time zone,
  called_off_by integer,
  checked_in_at timestamp with time zone,
  played_on date,
  score_posting integer,
  score_accepting integer,
  retired_by text,
  entered_by integer,
  entered_at timestamp with time zone,
  confirmed_by integer,
  auto_confirmed boolean DEFAULT false NOT NULL,
  disputed_by integer,
  disputed_at timestamp with time zone,
  dispute_note text,
  resolved_by_admin boolean DEFAULT false NOT NULL,
  completed_at timestamp with time zone,
  void_reason text,
  CONSTRAINT pv_arena_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE pv_arena_code_attempts (
  player_id integer NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE pv_arena_codes (
  id integer DEFAULT nextval('pv_arena_codes_id_seq'::regclass) NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  owner_id integer NOT NULL,
  challenge_id integer,
  status text DEFAULT 'live'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_by integer,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_arena_codes_pkey PRIMARY KEY (id)
);

CREATE TABLE pv_arena_pair_members (
  pair_id integer NOT NULL,
  player_id integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  CONSTRAINT pv_arena_pair_members_pkey PRIMARY KEY (pair_id, player_id)
);

CREATE TABLE pv_arena_pairs (
  id integer DEFAULT nextval('pv_arena_pairs_id_seq'::regclass) NOT NULL,
  player_low integer NOT NULL,
  player_high integer NOT NULL,
  name text,
  formed_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  ended_reason text,
  CONSTRAINT pv_arena_pairs_pkey PRIMARY KEY (id)
);

CREATE TABLE pv_arena_player_ranks (
  player_id integer NOT NULL,
  seen_index integer DEFAULT 0 NOT NULL,
  peak_index integer DEFAULT 0 NOT NULL,
  was_tarnished boolean DEFAULT false NOT NULL,
  polished_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_arena_player_ranks_pkey PRIMARY KEY (player_id)
);

CREATE TABLE pv_wv_labels (
  id integer DEFAULT nextval('pv_wv_labels_id_seq'::regclass) NOT NULL,
  player_id integer,
  video_name text NOT NULL,
  duration real,
  hits jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_wv_labels_pkey PRIMARY KEY (id)
);

CREATE TABLE pv_wv_models (
  id integer DEFAULT nextval('pv_wv_models_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  weights jsonb NOT NULL,
  n integer NOT NULL,
  sessions integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_wv_models_pkey PRIMARY KEY (id)
);

CREATE TABLE pv_wv_passes (
  id integer DEFAULT nextval('pv_wv_passes_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  kind text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  amount_cents integer NOT NULL,
  test boolean DEFAULT false NOT NULL,
  stripe_session text,
  challenge_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  used_at timestamp with time zone,
  CONSTRAINT pv_wv_passes_pkey PRIMARY KEY (id),
  CONSTRAINT pv_wv_passes_stripe_session_key UNIQUE (stripe_session)
);

CREATE TABLE pv_wv_updates (
  id integer DEFAULT nextval('pv_wv_updates_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  weights jsonb NOT NULL,
  n integer NOT NULL,
  player_id integer,
  meta jsonb,
  merged boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pv_wv_updates_pkey PRIMARY KEY (id)
);

CREATE TABLE rr_results (
  draw_id integer NOT NULL,
  mg_name text NOT NULL,
  session_date date NOT NULL,
  team_id integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  points_for integer NOT NULL,
  points_against integer NOT NULL,
  rr_points integer NOT NULL,
  finish_place integer NOT NULL,
  teams_count integer NOT NULL,
  CONSTRAINT rr_results_pkey PRIMARY KEY (draw_id, mg_name)
);

CREATE TABLE schema_runs (
  name text NOT NULL,
  deploy text NOT NULL,
  ran_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT schema_runs_pkey PRIMARY KEY (name, deploy)
);

CREATE TABLE session_alert_state (
  session_date date NOT NULL,
  state text DEFAULT 'ok'::text NOT NULL,
  headcount integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT session_alert_state_pkey PRIMARY KEY (session_date)
);

CREATE TABLE session_fill_ins (
  id integer DEFAULT nextval('session_fill_ins_id_seq'::regclass) NOT NULL,
  session_date date NOT NULL,
  membership_id integer,
  booking_id integer,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT session_fill_ins_one_target CHECK (((membership_id IS NULL) <> (booking_id IS NULL))),
  CONSTRAINT session_fill_ins_pkey PRIMARY KEY (id)
);

CREATE TABLE sessions (
  date date NOT NULL,
  max_spots integer DEFAULT 8 NOT NULL,
  booked_spots integer DEFAULT 0 NOT NULL,
  google_event_id text,
  calendar_summary text,
  event_start_time timestamp with time zone,
  synced_at timestamp with time zone,
  event_end_time timestamp with time zone,
  event_location text,
  courts integer DEFAULT 2 NOT NULL,
  registration_locked boolean DEFAULT false NOT NULL,
  mini_game boolean DEFAULT false NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (date)
);

CREATE TABLE shop_order_items (
  id integer DEFAULT nextval('shop_order_items_id_seq'::regclass) NOT NULL,
  order_id integer NOT NULL,
  product_id integer NOT NULL,
  variant_id integer NOT NULL,
  qty integer NOT NULL,
  unit_price_cents integer NOT NULL,
  label text NOT NULL,
  CONSTRAINT shop_order_items_pkey PRIMARY KEY (id)
);

CREATE TABLE shop_orders (
  id integer DEFAULT nextval('shop_orders_id_seq'::regclass) NOT NULL,
  player_id integer,
  email text NOT NULL,
  name text DEFAULT ''::text NOT NULL,
  status text NOT NULL,
  payment_method text NOT NULL,
  total_cents integer NOT NULL,
  stripe_payment_intent_id text,
  cash_invoice_id text,
  hold_expires_at timestamp with time zone,
  reminder_sent_at timestamp with time zone,
  paid_at timestamp with time zone,
  collected_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT shop_orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['card'::text, 'cash'::text]))),
  CONSTRAINT shop_orders_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'reserved_cash'::text, 'paid'::text, 'collected'::text, 'cancelled'::text, 'expired'::text, 'refunded'::text]))),
  CONSTRAINT shop_orders_pkey PRIMARY KEY (id),
  CONSTRAINT shop_orders_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id)
);

CREATE TABLE shop_products (
  id integer DEFAULT nextval('shop_products_id_seq'::regclass) NOT NULL,
  slug text NOT NULL,
  kind text DEFAULT 'merch'::text NOT NULL,
  name_en text NOT NULL,
  name_vi text DEFAULT ''::text NOT NULL,
  desc_en text DEFAULT ''::text NOT NULL,
  desc_vi text DEFAULT ''::text NOT NULL,
  price_cents integer NOT NULL,
  images jsonb DEFAULT '[]'::jsonb NOT NULL,
  has_fit boolean DEFAULT true NOT NULL,
  has_sizes boolean DEFAULT true NOT NULL,
  size_chart_men text,
  size_chart_women text,
  active boolean DEFAULT true NOT NULL,
  sort integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT shop_products_pkey PRIMARY KEY (id),
  CONSTRAINT shop_products_slug_key UNIQUE (slug)
);

CREATE TABLE shop_stock_log (
  id integer DEFAULT nextval('shop_stock_log_id_seq'::regclass) NOT NULL,
  variant_id integer NOT NULL,
  change text NOT NULL,
  stock_after integer NOT NULL,
  by_whom text DEFAULT 'admin'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT shop_stock_log_pkey PRIMARY KEY (id)
);

CREATE TABLE shop_variants (
  id integer DEFAULT nextval('shop_variants_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  fit text NOT NULL,
  size text NOT NULL,
  stock integer DEFAULT 0 NOT NULL,
  reserved integer DEFAULT 0 NOT NULL,
  sold integer DEFAULT 0 NOT NULL,
  CONSTRAINT shop_variants_reserved_check CHECK ((reserved >= 0)),
  CONSTRAINT shop_variants_stock_check CHECK ((stock >= 0)),
  CONSTRAINT shop_variants_pkey PRIMARY KEY (id),
  CONSTRAINT shop_variants_product_id_fit_size_key UNIQUE (product_id, fit, size)
);

CREATE TABLE sms_sends (
  id integer DEFAULT nextval('sms_sends_id_seq'::regclass) NOT NULL,
  purpose text NOT NULL,
  phone_hash text NOT NULL,
  ip_hash text,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT sms_sends_pkey PRIMARY KEY (id)
);

CREATE TABLE stripe_payouts (
  id text NOT NULL,
  amount_cents bigint NOT NULL,
  created_date date NOT NULL,
  arrival_date date NOT NULL,
  status text,
  CONSTRAINT stripe_payouts_pkey PRIMARY KEY (id)
);

CREATE TABLE waitlist (
  id integer DEFAULT nextval('waitlist_id_seq'::regclass) NOT NULL,
  session_date date,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  notified_at timestamp with time zone,
  CONSTRAINT waitlist_pkey PRIMARY KEY (id)
);

CREATE TABLE webhook_deliveries (
  id integer DEFAULT nextval('webhook_deliveries_id_seq'::regclass) NOT NULL,
  endpoint_id integer NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  delivered_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text]))),
  CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id)
);

CREATE TABLE webhook_endpoints (
  id integer DEFAULT nextval('webhook_endpoints_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_status text,
  CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id)
);

CREATE TABLE wv_labels (
  id integer DEFAULT nextval('wv_labels_id_seq'::regclass) NOT NULL,
  player_id integer,
  video_name text NOT NULL,
  duration real,
  hits jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT wv_labels_pkey PRIMARY KEY (id)
);

CREATE TABLE wv_models (
  id integer DEFAULT nextval('wv_models_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  weights jsonb NOT NULL,
  n integer NOT NULL,
  sessions integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT wv_models_pkey PRIMARY KEY (id)
);

CREATE TABLE wv_passes (
  id integer DEFAULT nextval('wv_passes_id_seq'::regclass) NOT NULL,
  player_id integer NOT NULL,
  kind text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  amount_cents integer NOT NULL,
  test boolean DEFAULT false NOT NULL,
  stripe_session text,
  challenge_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  used_at timestamp with time zone,
  CONSTRAINT wv_passes_pkey PRIMARY KEY (id),
  CONSTRAINT wv_passes_stripe_session_key UNIQUE (stripe_session)
);

CREATE TABLE wv_updates (
  id integer DEFAULT nextval('wv_updates_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  weights jsonb NOT NULL,
  n integer NOT NULL,
  player_id integer,
  meta jsonb,
  merged boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT wv_updates_pkey PRIMARY KEY (id)
);
--> statement-breakpoint
ALTER TABLE admin_handoffs ADD CONSTRAINT admin_handoffs_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE bank_matches ADD CONSTRAINT bank_matches_bank_txn_id_fkey FOREIGN KEY (bank_txn_id) REFERENCES bank_transactions(id) ON DELETE CASCADE;
ALTER TABLE bank_matches ADD CONSTRAINT bank_matches_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES finance_entries(id) ON DELETE CASCADE;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES finance_entries(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_session_date_fkey FOREIGN KEY (session_date) REFERENCES sessions(date);
ALTER TABLE cancellation_feedback ADD CONSTRAINT cancellation_feedback_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE club_roles ADD CONSTRAINT club_roles_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT;
ALTER TABLE message_threads ADD CONSTRAINT message_threads_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES message_threads(id) ON DELETE CASCADE;
ALTER TABLE mini_game_scores ADD CONSTRAINT mini_game_scores_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES mini_game_draws(id);
ALTER TABLE platform_admins ADD CONSTRAINT platform_admins_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT;
ALTER TABLE player_events ADD CONSTRAINT player_events_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE player_photos ADD CONSTRAINT player_photos_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE player_sessions ADD CONSTRAINT player_sessions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE session_alert_state ADD CONSTRAINT session_alert_state_session_date_fkey FOREIGN KEY (session_date) REFERENCES sessions(date);
ALTER TABLE shop_order_items ADD CONSTRAINT shop_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE shop_variants ADD CONSTRAINT shop_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES shop_products(id) ON DELETE CASCADE;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE;
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX admin_audit_log_at ON public.admin_audit_log USING btree (at DESC);
CREATE UNIQUE INDEX admin_invites_one_pending ON public.admin_invites USING btree (email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));
CREATE UNIQUE INDEX arena_challenges_one_open ON public.arena_challenges USING btree (posting_pair) WHERE (status = 'open'::text);
CREATE INDEX arena_challenges_status ON public.arena_challenges USING btree (status);
CREATE INDEX arena_codes_hash ON public.arena_codes USING btree (purpose, code_hash) WHERE (status = 'live'::text);
CREATE UNIQUE INDEX arena_pair_members_one_active ON public.arena_pair_members USING btree (player_id) WHERE active;
CREATE INDEX attendance_email_idx ON public.attendance USING btree (email, session_date);
CREATE INDEX auth_codes_email_idx ON public.auth_codes USING btree (email, created_at DESC);
CREATE INDEX bank_transactions_date_idx ON public.bank_transactions USING btree (txn_date);
CREATE UNIQUE INDEX day_requests_pending_idx ON public.day_requests USING btree (day, lower(email)) WHERE (notified_at IS NULL);
CREATE INDEX finance_entries_date_idx ON public.finance_entries USING btree (entry_date);
CREATE UNIQUE INDEX jersey_one_per_email ON public.jersey_registrations USING btree (email_normalized) WHERE (status = ANY (ARRAY['pending'::text, 'paid'::text]));
CREATE INDEX message_threads_player_idx ON public.message_threads USING btree (player_id, last_message_at DESC);
CREATE INDEX messages_thread_idx ON public.messages USING btree (thread_id, created_at);
CREATE UNIQUE INDEX mini_game_draws_one_active ON public.mini_game_draws USING btree ((true)) WHERE (archived_at IS NULL);
CREATE INDEX player_photos_player_idx ON public.player_photos USING btree (player_id, created_at DESC);
CREATE INDEX player_photos_status_idx ON public.player_photos USING btree (status, created_at DESC);
CREATE UNIQUE INDEX players_minigame_name_idx ON public.players USING btree (lower(minigame_name)) WHERE (minigame_name IS NOT NULL);
CREATE UNIQUE INDEX players_phone_verified_idx ON public.players USING btree (phone_e164) WHERE ((phone_verified_at IS NOT NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX pv_arena_challenges_one_open ON public.pv_arena_challenges USING btree (posting_pair) WHERE (status = 'open'::text);
CREATE INDEX pv_arena_challenges_status ON public.pv_arena_challenges USING btree (status);
CREATE INDEX pv_arena_codes_hash ON public.pv_arena_codes USING btree (purpose, code_hash) WHERE (status = 'live'::text);
CREATE UNIQUE INDEX pv_arena_pair_members_one_active ON public.pv_arena_pair_members USING btree (player_id) WHERE active;
CREATE INDEX pv_wv_passes_player ON public.pv_wv_passes USING btree (player_id, status);
CREATE INDEX rr_results_name_idx ON public.rr_results USING btree (lower(mg_name), session_date);
CREATE UNIQUE INDEX session_fill_ins_booking_idx ON public.session_fill_ins USING btree (session_date, booking_id) WHERE (booking_id IS NOT NULL);
CREATE UNIQUE INDEX session_fill_ins_membership_idx ON public.session_fill_ins USING btree (session_date, membership_id) WHERE (membership_id IS NOT NULL);
CREATE INDEX sms_sends_sent_at_idx ON public.sms_sends USING btree (sent_at);
CREATE INDEX webhook_deliveries_due_idx ON public.webhook_deliveries USING btree (status, next_attempt_at);
CREATE INDEX wv_passes_player ON public.wv_passes USING btree (player_id, status);
--> statement-breakpoint
ALTER SEQUENCE admin_audit_log_id_seq OWNED BY admin_audit_log.id;
ALTER SEQUENCE admin_handoffs_id_seq OWNED BY admin_handoffs.id;
ALTER SEQUENCE admin_invites_id_seq OWNED BY admin_invites.id;
ALTER SEQUENCE api_tokens_id_seq OWNED BY api_tokens.id;
ALTER SEQUENCE arena_challenges_id_seq OWNED BY arena_challenges.id;
ALTER SEQUENCE arena_codes_id_seq OWNED BY arena_codes.id;
ALTER SEQUENCE arena_pairs_id_seq OWNED BY arena_pairs.id;
ALTER SEQUENCE auth_codes_id_seq OWNED BY auth_codes.id;
ALTER SEQUENCE bank_rules_id_seq OWNED BY bank_rules.id;
ALTER SEQUENCE bank_transactions_id_seq OWNED BY bank_transactions.id;
ALTER SEQUENCE bookings_id_seq OWNED BY bookings.id;
ALTER SEQUENCE cancellation_feedback_id_seq OWNED BY cancellation_feedback.id;
ALTER SEQUENCE day_requests_id_seq OWNED BY day_requests.id;
ALTER SEQUENCE donations_id_seq OWNED BY donations.id;
ALTER SEQUENCE finance_entries_id_seq OWNED BY finance_entries.id;
ALTER SEQUENCE jersey_registrations_id_seq OWNED BY jersey_registrations.id;
ALTER SEQUENCE memberships_id_seq OWNED BY memberships.id;
ALTER SEQUENCE message_threads_id_seq OWNED BY message_threads.id;
ALTER SEQUENCE messages_id_seq OWNED BY messages.id;
ALTER SEQUENCE mini_game_draws_id_seq OWNED BY mini_game_draws.id;
ALTER SEQUENCE player_events_id_seq OWNED BY player_events.id;
ALTER SEQUENCE player_photos_id_seq OWNED BY player_photos.id;
ALTER SEQUENCE player_sessions_id_seq OWNED BY player_sessions.id;
ALTER SEQUENCE players_id_seq OWNED BY players.id;
ALTER SEQUENCE pv_arena_challenges_id_seq OWNED BY pv_arena_challenges.id;
ALTER SEQUENCE pv_arena_codes_id_seq OWNED BY pv_arena_codes.id;
ALTER SEQUENCE pv_arena_pairs_id_seq OWNED BY pv_arena_pairs.id;
ALTER SEQUENCE pv_wv_labels_id_seq OWNED BY pv_wv_labels.id;
ALTER SEQUENCE pv_wv_models_id_seq OWNED BY pv_wv_models.id;
ALTER SEQUENCE pv_wv_passes_id_seq OWNED BY pv_wv_passes.id;
ALTER SEQUENCE pv_wv_updates_id_seq OWNED BY pv_wv_updates.id;
ALTER SEQUENCE session_fill_ins_id_seq OWNED BY session_fill_ins.id;
ALTER SEQUENCE shop_order_items_id_seq OWNED BY shop_order_items.id;
ALTER SEQUENCE shop_orders_id_seq OWNED BY shop_orders.id;
ALTER SEQUENCE shop_products_id_seq OWNED BY shop_products.id;
ALTER SEQUENCE shop_stock_log_id_seq OWNED BY shop_stock_log.id;
ALTER SEQUENCE shop_variants_id_seq OWNED BY shop_variants.id;
ALTER SEQUENCE sms_sends_id_seq OWNED BY sms_sends.id;
ALTER SEQUENCE waitlist_id_seq OWNED BY waitlist.id;
ALTER SEQUENCE webhook_deliveries_id_seq OWNED BY webhook_deliveries.id;
ALTER SEQUENCE webhook_endpoints_id_seq OWNED BY webhook_endpoints.id;
ALTER SEQUENCE wv_labels_id_seq OWNED BY wv_labels.id;
ALTER SEQUENCE wv_models_id_seq OWNED BY wv_models.id;
ALTER SEQUENCE wv_passes_id_seq OWNED BY wv_passes.id;
ALTER SEQUENCE wv_updates_id_seq OWNED BY wv_updates.id;
