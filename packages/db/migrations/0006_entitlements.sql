-- Phase 3 step 9: plans, what each club is on, and usage per club
-- (build plan §6.5 "Business model", §11.2, §11.3 gate 4).
--
-- Additive only: three new tables, one plan and one club_plans row. No
-- existing row changes. Billing stays off (BILLING_ENABLED=false) and every
-- module stays available; these tables are read by can() and written by the
-- usage meter.
--
--   plans           platform-wide: what a plan includes, for which country and
--                   sport, and what it costs (minor units + currency).
--   club_plans      which plan a club is on, and since when. One current row
--                   per club.
--   usage_counters  one number per club, metric and calendar month.
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"sport" text,
	"tiers" text[] DEFAULT ARRAY['free']::text[] NOT NULL,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"billing_interval" text,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_id_check" CHECK (id ~ '^[a-z][a-z0-9-]*$'::text),
	CONSTRAINT "plans_country_check" CHECK (country ~ '^[A-Z]{2}$'::text),
	CONSTRAINT "plans_currency_check" CHECK (currency ~ '^[A-Z]{3}$'::text),
	CONSTRAINT "plans_price_minor_check" CHECK (price_minor >= 0),
	CONSTRAINT "plans_billing_interval_check" CHECK (billing_interval = ANY (ARRAY['month'::text, 'year'::text]))
);
--> statement-breakpoint
CREATE TABLE "club_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_plans_status_check" CHECK (status = ANY (ARRAY['active'::text, 'trial'::text, 'past_due'::text, 'canceled'::text])),
	CONSTRAINT "club_plans_period_check" CHECK (ends_at IS NULL OR ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" integer NOT NULL,
	"metric" text NOT NULL,
	"period" date NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pkey" PRIMARY KEY("tenant_id","metric","period"),
	CONSTRAINT "usage_counters_metric_check" CHECK (metric ~ '^[a-z][a-z0-9_.]*$'::text),
	CONSTRAINT "usage_counters_period_check" CHECK (EXTRACT(day FROM period) = 1),
	CONSTRAINT "usage_counters_quantity_check" CHECK (quantity >= 0)
);
--> statement-breakpoint
ALTER TABLE "club_plans" ADD CONSTRAINT "club_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_plans" ADD CONSTRAINT "club_plans_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_plans_current_idx" ON "club_plans" USING btree ("tenant_id") WHERE (ends_at IS NULL);--> statement-breakpoint
CREATE INDEX "club_plans_plan_id_idx" ON "club_plans" USING btree ("plan_id");--> statement-breakpoint
-- New Zealand badminton clubs are free for good (decision U, §11.2). The
-- fair-use limits are set from the cost model (§11.3 gate 4) and are empty
-- until then: no limit is applied.
INSERT INTO plans (id, name, country, sport, tiers, price_minor, currency, billing_interval, limits)
VALUES ('nz-badminton-free', 'New Zealand badminton (free for good)', 'NZ', 'badminton', ARRAY['free'], 0, 'NZD', NULL, '{}'::jsonb);
--> statement-breakpoint
INSERT INTO club_plans (tenant_id, plan_id, status, note)
SELECT id, 'nz-badminton-free', 'active', 'Club #1: free for good (build plan §11.2)' FROM tenants WHERE slug = 'three-wolves';
