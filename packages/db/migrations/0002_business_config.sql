-- Phase 2 PR 6: business config moves out of Sanity into the database
-- (build plan §5, Sanity row). Edited in Admin → Settings → Pricing.
--
-- Class: additive (two new tables) plus a data copy (test plan §4.1).
-- Nothing existing changes. The rows below are the published Sanity
-- documents read on 23 Nov 2026 (tests/fixtures/business-config/
-- sanity-2026-11-23.json), copied exactly: locale fields keep their en/vi
-- text (Sanity's internal _type/_key are dropped), prices in NZD as entered.
-- tests/business-config.test.ts checks this file against that snapshot, and
-- scripts/verify-business-config.mjs compares a live database with live
-- Sanity before and after the production run.
--
-- maxCasualSpots is unset in Sanity (the app uses SESSION_CAPACITY), so it
-- is stored as JSON null. bookingLockDays (14) isn't read by the app today;
-- it is copied so nothing is lost.
CREATE TABLE "club_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "pricing_plans" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_nzd" numeric(10, 2),
	"period_label" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stripe_price_id" text,
	"sort" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "pricing_plans_plan_id_check" CHECK (plan_id = ANY (ARRAY['casual'::text, 'fridayMonthly'::text, 'fridayQuarterly'::text, 'wednesdayMonthly'::text, 'wednesdayQuarterly'::text]))
);
--> statement-breakpoint
INSERT INTO pricing_plans (plan_id, name, description, price_nzd, period_label, featured, features, stripe_price_id, sort) VALUES
  ('casual', '{"en": "CASUAL", "vi": "ĐÁNH LẺ"}'::jsonb, '{"en": "Pay per session, no commitment", "vi": "Trả tiền theo buổi, không cam kết"}'::jsonb, 10, '{"en": "PER SESSION", "vi": "MỖI BUỔI"}'::jsonb, FALSE, '[{"en": "Single court access", "vi": "Chơi cầu một buổi"}, {"en": "Shuttlecocks provided", "vi": "Có sẵn cầu"}, {"en": "Racquet loan available", "vi": "Có thể mượn vợt"}]'::jsonb, 'price_1TeA0L2FaqyoK74qII5td5VM', 1),
  ('fridayMonthly', '{"en": "MONTHLY (FRIDAY)", "vi": "HÀNG THÁNG (THỨ SÁU)"}'::jsonb, '{"en": "Popular monthly membership", "vi": "Gói hội viên theo tháng (HOT)"}'::jsonb, 33, '{"en": "MONTHLY", "vi": "HẰNG THÁNG"}'::jsonb, TRUE, '[{"en": "Weekly play", "vi": "Chơi cầu hằng tuần"}, {"en": "Shuttle cocks provided", "vi": "Cầu có sẵn"}, {"en": "Racquet loan available", "vi": "Có thể mượn vợt"}, {"en": "Club community & social events", "vi": "Sự kiện cộng đồng và của CLB"}, {"en": "Cancel anytime", "vi": "Huỷ bất kỳ lúc nào"}]'::jsonb, 'price_1Te8Jl2FaqyoK74qKA2xCahN', 2),
  ('fridayQuarterly', '{"en": "QUARTERLY (FRIDAY)", "vi": "HÀNG QUÝ (THỨ SÁU)"}'::jsonb, '{"en": "Quarterly membership — save ~15%", "vi": "Hội viên theo quý – Tiết kiệm ~15% "}'::jsonb, 85, '{"en": "EVERY 3 MONTHS", "vi": "MỖI 3 THÁNG"}'::jsonb, FALSE, '[{"en": "Weekly play", "vi": "Chơi cầu hằng tuần"}, {"en": "Shuttle cocks provided", "vi": "Cầu có sẵn"}, {"en": "Racquet loan available", "vi": "Có thể mượn vợt"}, {"en": "Club community & social events", "vi": "Sự kiện cộng đồng và của CLB"}, {"en": "Cancel anytime", "vi": "Huỷ bất kỳ lúc nào"}, {"en": "The best saving membership – Saves ~15% compared to monthly ($99/quarter)", "vi": "Gói hội viên tiết kiệm nhất – Tiết kiệm ~15% so với gói hàng tháng ($99/quý)"}]'::jsonb, 'price_1Te8Jl2FaqyoK74qc6UThmLu', 3),
  ('wednesdayMonthly', '{"en": "MONTHLY (WEDNESDAY)", "vi": "HÀNG THÁNG (THỨ TƯ)"}'::jsonb, '{}'::jsonb, 33, '{}'::jsonb, FALSE, '[]'::jsonb, 'price_1UDt2pETzBGat4YgPHdnXMKt', 4),
  ('wednesdayQuarterly', '{"en": "QUARTERLY (WEDNESDAY)", "vi": "HÀNG QUÝ (THỨ TƯ)"}'::jsonb, '{}'::jsonb, 85, '{}'::jsonb, FALSE, '[]'::jsonb, 'price_1UDt34ETzBGat4YgxSIFQZZv', 5);
--> statement-breakpoint
INSERT INTO club_settings (key, value) VALUES
  ('max_casual_spots', NULL),
  ('booking_lock_days', '14'::jsonb);
