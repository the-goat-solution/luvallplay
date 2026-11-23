-- Phase 3 step 1: the tenants schema, with Three Wolves as club #1
-- (build plan §6.1, §6.6 step 1, §6.8).
--
-- Class: additive (test plan §4.1). Five new tables; nothing existing
-- changes, so the current app version keeps working with them in place.
--
--   tenants          one row per club
--   tenant_modules   which modules a club has on, and each module's settings
--   club_members     a person's role and status in a club
--   junior_profiles, guardianships
--                    junior accounts (§6.8), created empty; features are Phase 3b
--
-- Then a data copy:
-- - Three Wolves' row: time zone, currency, bank details, theme and terms,
--   copied from today's constants (lib/constants.ts, lib/jersey.ts,
--   packages/ui/src/three-wolves.ts). tests/tenants.test.ts compares this
--   file with those constants.
-- - Every module the club runs today, switched on, with the settings that
--   are constants today (courts → players, membership days, cycle lengths).
-- - One club_members row per account: role from club_roles (owner, admin,
--   coach), otherwise member. club_roles is untouched and stays the source
--   for admin access until reads switch (step 11), so nobody's access
--   changes here. The INSERT is idempotent (ON CONFLICT DO NOTHING); the
--   same statement is lib/tenant-members.ts's reconcile, safe to run again.
--
-- New foreign keys to accounts are ON DELETE RESTRICT (test plan §4.2).
CREATE TABLE "club_members" (
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leaderboard_visible" boolean DEFAULT true NOT NULL,
	"global_profile_visible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_members_pkey" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "club_members_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text, 'member'::text, 'guest'::text])),
	CONSTRAINT "club_members_status_check" CHECK (status = ANY (ARRAY['active'::text, 'disabled'::text]))
);
--> statement-breakpoint
CREATE TABLE "guardianships" (
	"guardian_user_id" integer NOT NULL,
	"junior_profile_id" integer NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardianships_pkey" PRIMARY KEY("guardian_user_id","junior_profile_id")
);
--> statement-breakpoint
CREATE TABLE "junior_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"guardian_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"birth_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_modules" (
	"tenant_id" integer NOT NULL,
	"module_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled_at" timestamp with time zone,
	"locked" text,
	"lock_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "tenant_modules_pkey" PRIMARY KEY("tenant_id","module_id"),
	CONSTRAINT "tenant_modules_locked_check" CHECK (locked = ANY (ARRAY['on'::text, 'off'::text]))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"country" text NOT NULL,
	"region" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"languages" text[] DEFAULT '{"en"}' NOT NULL,
	"sports" text[] DEFAULT '{}' NOT NULL,
	"payment_mode" text DEFAULT 'free' NOT NULL,
	"incorporated" text DEFAULT 'unsure' NOT NULL,
	"stripe_status" text DEFAULT 'none' NOT NULL,
	"bank_details" jsonb,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug"),
	CONSTRAINT "tenants_custom_domain_key" UNIQUE("custom_domain"),
	CONSTRAINT "tenants_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text),
	CONSTRAINT "tenants_status_check" CHECK (status = ANY (ARRAY['setup'::text, 'active'::text, 'suspended'::text, 'closed'::text])),
	CONSTRAINT "tenants_country_check" CHECK (country ~ '^[A-Z]{2}$'::text),
	CONSTRAINT "tenants_region_check" CHECK (region ~ '^[a-z][a-z0-9-]*$'::text),
	CONSTRAINT "tenants_currency_check" CHECK (currency ~ '^[A-Z]{3}$'::text),
	CONSTRAINT "tenants_payment_mode_check" CHECK (payment_mode = ANY (ARRAY['free'::text, 'offline'::text, 'online'::text])),
	CONSTRAINT "tenants_incorporated_check" CHECK (incorporated = ANY (ARRAY['yes'::text, 'no'::text, 'unsure'::text])),
	CONSTRAINT "tenants_stripe_status_check" CHECK (stripe_status = ANY (ARRAY['none'::text, 'connecting'::text, 'connected'::text])),
	CONSTRAINT "tenants_custom_domain_check" CHECK (custom_domain = lower(custom_domain))
);
--> statement-breakpoint
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_junior_profile_id_fkey" FOREIGN KEY ("junior_profile_id") REFERENCES "public"."junior_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junior_profiles" ADD CONSTRAINT "junior_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junior_profiles" ADD CONSTRAINT "junior_profiles_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_members_user_id_idx" ON "club_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guardianships_junior_profile_id_idx" ON "guardianships" USING btree ("junior_profile_id");--> statement-breakpoint
CREATE INDEX "junior_profiles_tenant_id_idx" ON "junior_profiles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "junior_profiles_guardian_user_id_idx" ON "junior_profiles" USING btree ("guardian_user_id");--> statement-breakpoint
INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms, custom_domain) VALUES
  ('three-wolves', 'Three Wolves Badminton Club', 'active', 'NZ', 'syd', 'Pacific/Auckland', 'NZD', ARRAY['en', 'vi'], ARRAY['badminton'], 'online', 'yes', 'connected',
   '{"account_name":"THREE WOLVES BADMINTON CLUB INC","account_number":"01-0798-0949150-00","cash_at_hall":true}'::jsonb,
   '{"kind":"imported","brand":"three-wolves","color":{"navy":"#184467","navy-dark":"#0e2c3f","navy-mid":"#1e5a8a","cream":"#fcfbf2","cream-dark":"#f2efe3","steel":"#b4ccd9","steel-light":"#daeaf2","bronze":"#C4892A","bronze-dark":"#9e6d1f","bronze-light":"#e2ae60","white":"#ffffff","text-dark":"#0d1b26","text-mid":"#3a526a","text-light":"#7a9ab0"},"font":{"display":"''Copperplate'', ''Copperplate Gothic Light'', serif","sans":"''Montserrat'', ''Helvetica Neue'', sans-serif"}}'::jsonb,
   '{"points_name":"Wolf Points","vision_name":"Wolf Vision"}'::jsonb,
   'threewolvesbadminton.org');
--> statement-breakpoint
INSERT INTO tenant_modules (tenant_id, module_id, enabled, settings, enabled_at)
SELECT t.id, m.module_id, TRUE, m.settings, now()
FROM tenants t, (VALUES
  ('home', '{}'::jsonb),
  ('play-days', '{"courtsToMaxPlayers":{"1":6,"2":12,"3":18,"4":22},"sessionCapacity":12,"casualOnlyDefaultCourts":1,"bookingWindowDays":30,"bookingCutoffHour":17}'::jsonb),
  ('people', '{}'::jsonb),
  ('messages', '{}'::jsonb),
  ('website', '{}'::jsonb),
  ('settings', '{}'::jsonb),
  ('calendar-sync', '{}'::jsonb),
  ('casual-play', '{}'::jsonb),
  ('court-board', '{}'::jsonb),
  ('round-robin', '{"miniGameMaxPlayers":16}'::jsonb),
  ('day-requests', '{}'::jsonb),
  ('memberships', '{"days":["friday","wednesday"],"defaultCourts":{"friday":2,"wednesday":1},"cycleDays":{"monthly":28,"quarterly":84},"startSearchDays":90,"pendingHoldMinutes":30}'::jsonb),
  ('payments-to-check', '{}'::jsonb),
  ('bank-matching', '{}'::jsonb),
  ('card-payments', '{}'::jsonb),
  ('finance', '{}'::jsonb),
  ('shop', '{}'::jsonb),
  ('donations', '{"minAmount":200,"maxAmount":500000}'::jsonb),
  ('arena', '{}'::jsonb),
  ('vision', '{}'::jsonb),
  ('gallery', '{}'::jsonb),
  ('integrations', '{}'::jsonb)
) AS m(module_id, settings)
WHERE t.slug = 'three-wolves';

--> statement-breakpoint
INSERT INTO club_members (tenant_id, user_id, role, status, joined_at, leaderboard_visible)
SELECT t.id, p.id, COALESCE(r.role, 'member'), 'active', p.created_at, p.leaderboard_visible
FROM players p
CROSS JOIN tenants t
LEFT JOIN club_roles r ON r.player_id = p.id
WHERE t.slug = 'three-wolves'
ON CONFLICT (tenant_id, user_id) DO NOTHING;
