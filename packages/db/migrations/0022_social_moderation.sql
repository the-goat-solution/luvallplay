-- Lane S (Social and Marketplace), Social plan Task 2a: the Social tables,
-- blocks, and suspensions. Built hidden (decision AQ): nothing reads or
-- writes these until a club is on the Social pilot list.
--
-- social_profiles     a person's opt-in profile: a display name and a random
--                     public id (what other people see, never the real name
--                     or the account id), who may see it, the 18+
--                     confirmation and the rules version they accepted.
-- social_follows      who follows whom.
-- social_posts        a post in one club's space. Automatic posts (a match, a
--                     rank-up) carry ref_key, unique per author and kind, so
--                     the same event arriving twice makes one post.
-- social_comments, social_kudos   on a post; they go when the post goes.
-- social_club_bans    a club switches a person off in its own space.
-- user_blocks         one person blocks another (shared with the Marketplace).
-- player_suspensions  a moderator's decisions about a person. Insert only:
--                     a lift is a new row, and the database gives each row
--                     its id and time. The row names the account by id WITHOUT a foreign
--                     key, and keeps keyed indexes of the email and phone the
--                     account had (never the values), so it stands when the
--                     account is deleted and the same email or phone signing
--                     up again is still suspended.
--
-- Additive: eight new, empty tables and two functions. No row of any
-- existing table changes, and the app runs unchanged without them.
--
-- Platform-wide, like player_sessions and push_devices: a profile, a follow
-- and a block belong to a person's account across clubs, so no tenant_id and
-- no row-level security (tests/tenant-id.test.ts, tenant-isolation.test.ts).
-- Where a row sits in one club's space the column is club_id, and the
-- queries name the club themselves.
CREATE TABLE social_profiles (
  player_id integer NOT NULL,
  -- What other people see and send back: 12 letters and digits, random.
  public_id text NOT NULL,
  display_name text NOT NULL,
  bio text,
  visibility text DEFAULT 'club' NOT NULL,
  -- "I am 18 or older", and when it was said. Opting in is impossible without it.
  adult_confirmed_at timestamp with time zone NOT NULL,
  rules_version text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_profiles_pkey PRIMARY KEY (player_id),
  CONSTRAINT social_profiles_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_profiles_public_id_key UNIQUE (public_id),
  CONSTRAINT social_profiles_public_id_check CHECK (public_id ~ '^[0-9A-Za-z]{12}$'),
  -- The limits are SOCIAL_LIMITS in @luvallplay/core/social, counted in characters.
  CONSTRAINT social_profiles_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 40),
  CONSTRAINT social_profiles_bio_check CHECK (char_length(bio) <= 160),
  CONSTRAINT social_profiles_visibility_check CHECK (visibility IN ('club', 'everyone')),
  CONSTRAINT social_profiles_rules_version_check CHECK (char_length(rules_version) BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE social_follows (
  follower_id integer NOT NULL,
  followee_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_follows_pkey PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT social_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_follows_not_self_check CHECK (follower_id <> followee_id)
);
--> statement-breakpoint
CREATE INDEX social_follows_followee_id_idx ON social_follows (followee_id);
--> statement-breakpoint
CREATE TABLE social_posts (
  id bigserial PRIMARY KEY,
  author_id integer NOT NULL,
  -- The club whose space the post is in.
  club_id integer NOT NULL,
  kind text NOT NULL,
  body text,
  -- Automatic posts only: "challenge:<id>:<side>", "rank:<rank>".
  ref_key text,
  photo_id integer,
  state text DEFAULT 'visible' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_posts_club_id_fkey FOREIGN KEY (club_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT social_posts_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES player_photos(id) ON DELETE RESTRICT,
  CONSTRAINT social_posts_author_kind_ref_key UNIQUE (author_id, kind, ref_key),
  CONSTRAINT social_posts_kind_check CHECK (kind IN ('match', 'rank_up', 'photo', 'text')),
  CONSTRAINT social_posts_state_check CHECK (state IN ('visible', 'held', 'hidden', 'removed')),
  CONSTRAINT social_posts_body_check CHECK (char_length(body) <= 500),
  CONSTRAINT social_posts_ref_key_check CHECK (char_length(ref_key) BETWEEN 1 AND 80),
  CONSTRAINT social_posts_text_has_body_check CHECK (kind <> 'text' OR (body IS NOT NULL AND char_length(body) >= 1)),
  -- Without its key an automatic post could be made twice.
  CONSTRAINT social_posts_auto_has_key_check CHECK (kind NOT IN ('match', 'rank_up') OR ref_key IS NOT NULL)
);
--> statement-breakpoint
-- The feed pages on (created_at, id), newest first: everyone's, one club's, one author's.
CREATE INDEX social_posts_created_idx ON social_posts (created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX social_posts_club_created_idx ON social_posts (club_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX social_posts_author_created_idx ON social_posts (author_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX social_posts_photo_id_idx ON social_posts (photo_id) WHERE photo_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE social_comments (
  id bigserial PRIMARY KEY,
  post_id bigint NOT NULL,
  author_id integer NOT NULL,
  body text NOT NULL,
  state text DEFAULT 'visible' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE,
  CONSTRAINT social_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_comments_body_check CHECK (char_length(body) BETWEEN 1 AND 300),
  CONSTRAINT social_comments_state_check CHECK (state IN ('visible', 'held', 'hidden', 'removed'))
);
--> statement-breakpoint
CREATE INDEX social_comments_post_idx ON social_comments (post_id, created_at, id);
--> statement-breakpoint
CREATE INDEX social_comments_author_id_idx ON social_comments (author_id);
--> statement-breakpoint
CREATE TABLE social_kudos (
  post_id bigint NOT NULL,
  player_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_kudos_pkey PRIMARY KEY (post_id, player_id),
  CONSTRAINT social_kudos_post_id_fkey FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE,
  CONSTRAINT social_kudos_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX social_kudos_player_id_idx ON social_kudos (player_id);
--> statement-breakpoint
CREATE TABLE social_club_bans (
  club_id integer NOT NULL,
  player_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The club admin who did it.
  created_by integer,
  CONSTRAINT social_club_bans_pkey PRIMARY KEY (club_id, player_id),
  CONSTRAINT social_club_bans_club_id_fkey FOREIGN KEY (club_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT social_club_bans_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT social_club_bans_created_by_fkey FOREIGN KEY (created_by) REFERENCES players(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX social_club_bans_player_id_idx ON social_club_bans (player_id);
--> statement-breakpoint
CREATE TABLE user_blocks (
  blocker_id integer NOT NULL,
  blocked_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT user_blocks_not_self_check CHECK (blocker_id <> blocked_id)
);
--> statement-breakpoint
CREATE INDEX user_blocks_blocked_id_idx ON user_blocks (blocked_id);
--> statement-breakpoint
CREATE TABLE player_suspensions (
  -- Which row is later is told by id, so the database alone gives it out:
  -- the app's role can't write this column, or created_at (grants below).
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The account the decision was made about. No foreign key, on purpose: the
  -- row must stand whatever happens to the account (a foreign key to players
  -- would have to be RESTRICT, and would then tie the account's row to this one).
  player_id integer,
  -- 'suspend', or 'unsuspend' for a lift. Every suspend row stands on its
  -- own until a LATER unsuspend row for the same player_id covers it ('all'
  -- lifts everything; 'social' or 'market' lifts rows of that scope only).
  action text DEFAULT 'suspend' NOT NULL,
  scope text NOT NULL,
  -- When a suspension ends. NULL: it doesn't.
  until timestamp with time zone,
  -- A short code (a report reason, 'appeal_upheld', ...). Never free text.
  reason_code text NOT NULL,
  -- Keyed indexes (CONTACT_INDEX_KEYS; purposes "suspension.email" and
  -- "suspension.phone") of the email and the VERIFIED phone the account had
  -- when the row was written. NULL when it had none or no index key was set.
  -- index_kid names the key: that key must stay listed for as long as the
  -- row should match. A lift never carries one: it is about an account only.
  email_index text,
  phone_index text,
  index_kid text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  -- The moderator's account id. No foreign key, for the same reason.
  created_by integer,
  CONSTRAINT player_suspensions_action_check CHECK (action IN ('suspend', 'unsuspend')),
  CONSTRAINT player_suspensions_scope_check CHECK (scope IN ('social', 'market', 'all')),
  CONSTRAINT player_suspensions_reason_code_check CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- The shape of an index (43 base64url characters): an email or a phone number can't be stored by mistake.
  CONSTRAINT player_suspensions_email_index_check CHECK (email_index ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT player_suspensions_phone_index_check CHECK (phone_index ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT player_suspensions_index_kid_check CHECK ((index_kid IS NOT NULL) = (email_index IS NOT NULL OR phone_index IS NOT NULL)),
  CONSTRAINT player_suspensions_names_someone_check CHECK (player_id IS NOT NULL OR email_index IS NOT NULL OR phone_index IS NOT NULL),
  CONSTRAINT player_suspensions_unsuspend_has_no_end_check CHECK (action <> 'unsuspend' OR until IS NULL),
  CONSTRAINT player_suspensions_unsuspend_names_account_check CHECK (action <> 'unsuspend' OR (player_id IS NOT NULL AND email_index IS NULL AND phone_index IS NULL))
);
--> statement-breakpoint
CREATE INDEX player_suspensions_player_idx ON player_suspensions (player_id, id DESC) WHERE player_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX player_suspensions_email_index_idx ON player_suspensions (email_index, id DESC) WHERE email_index IS NOT NULL;
--> statement-breakpoint
CREATE INDEX player_suspensions_phone_index_idx ON player_suspensions (phone_index, id DESC) WHERE phone_index IS NOT NULL;
--> statement-breakpoint
-- Cross-club reads. Under TENANT_SCOPE=enforce the app's role sees only its
-- own club's club_members and tenant_modules, but a person's social clubs are
-- all of theirs. These two functions run as their owner (which row-level
-- security does not bind), with a fixed search path, as link_account_to_rows
-- does (0007), and answer only the one narrow question each.
--
-- "Social is on for the club" here means the club's tenant_modules row says
-- so. The platform's own switch (the pilot list) is applied by the app on
-- top of this (lib/social/access.ts): the database can't read that setting.
CREATE FUNCTION social_clubs_of(p_player_id integer) RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT cm.tenant_id::bigint
  FROM club_members cm
  JOIN tenants t ON t.id = cm.tenant_id
  JOIN tenant_modules m ON m.tenant_id = cm.tenant_id
  WHERE cm.user_id = p_player_id AND cm.status = 'active' AND t.status = 'active'
    AND m.module_id = 'social' AND m.enabled
  ORDER BY 1
$fn$;
--> statement-breakpoint
CREATE FUNCTION shares_social_club(p_a integer, p_b integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM social_clubs_of(p_a) a(club_id) JOIN social_clubs_of(p_b) b(club_id) USING (club_id))
$fn$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON social_profiles, social_follows, social_posts, social_comments, social_kudos, social_club_bans, user_blocks TO luvallplay_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE social_posts_id_seq, social_comments_id_seq TO luvallplay_app;
--> statement-breakpoint
DO $$
BEGIN
  -- New tables get every right by default (0007). Take back what must not
  -- happen: a suspension is written once and never changed or removed by the
  -- app. A lift or a change is a new row.
  -- Nor may it choose a row's id or time (rows are ordered by id): it may
  -- write every column but those two.
  REVOKE ALL ON player_suspensions FROM luvallplay_app;
  REVOKE ALL ON SEQUENCE player_suspensions_id_seq FROM luvallplay_app;
  GRANT SELECT ON player_suspensions TO luvallplay_app;
  GRANT INSERT (player_id, action, scope, until, reason_code, email_index, phone_index, index_kid, created_by) ON player_suspensions TO luvallplay_app;
  -- A function can be run by anyone unless that is taken back. These two
  -- read across clubs, so only the app's role may call them.
  REVOKE ALL ON FUNCTION social_clubs_of(integer), shares_social_club(integer, integer) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION social_clubs_of(integer), shares_social_club(integer, integer) TO luvallplay_app;
END $$;
