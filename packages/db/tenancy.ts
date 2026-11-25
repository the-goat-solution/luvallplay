// Which tables belong to a club and which to the platform (build plan §6.1).
//
// Every table in the public schema is in exactly one list; a test fails on a
// table that is in neither (tests/tenant-id.test.ts), so a new table can't
// ship without the decision being made. The lists drive the tenant_id
// checks now, and row-level security and the tenant-isolation suite later
// (Phase 3 step 10).

/** Club-owned: every row has a tenant_id, and a club only ever sees its own. */
export const CLUB_OWNED_TABLES = [
  "admin_audit_log",
  "admin_invites",
  "api_tokens",
  "arena_after_game",
  "arena_challenges",
  "arena_code_attempts",
  "arena_codes",
  "arena_match_stats",
  "arena_pair_members",
  "arena_pairs",
  "arena_player_ranks",
  "attendance",
  "bank_matches",
  "bank_rules",
  "bank_transactions",
  "bookings",
  "cancellation_feedback",
  "casual_play_profiles",
  "casual_play_sessions",
  "club_members",
  "club_plans",
  "club_roles",
  "club_settings",
  "day_requests",
  "day_signup_settings",
  "donations",
  "finance_entries",
  "finance_settings",
  "finance_sync_state",
  "guardianships",
  "jersey_registrations",
  "junior_attendance",
  "junior_bookings",
  "junior_profiles",
  "membership_reminders_sent",
  "memberships",
  "message_threads",
  "messages",
  "mini_game_draws",
  "mini_game_scores",
  "player_absences",
  "player_photos",
  "pricing_plans",
  "rr_results",
  "session_alert_state",
  "session_fill_ins",
  "sessions",
  "shop_order_items",
  "shop_orders",
  "shop_products",
  "shop_stock_log",
  "shop_variants",
  "stripe_payouts",
  "tenant_modules",
  "usage_counters",
  "waitlist",
  "webhook_deliveries",
  "webhook_endpoints",
  "wv_labels",
  "wv_models",
  "wv_passes",
  "wv_updates",
] as const;

/**
 * Platform-wide: accounts and sign-in (one Luvallplay account across clubs),
 * the clubs themselves, platform staff, and leftovers that are no longer
 * used. No tenant_id.
 */
export const PLATFORM_TABLES = [
  "admin_handoffs", // single-use sign-in handoff for an account
  "auth_codes", // sign-in codes
  "plans", // what Luvallplay offers, per country and sport
  "platform_admins",
  "player_events", // account events (sign-in, install)
  "player_sessions",
  "player_settings", // platform switches (SMS on/off, alert timestamps)
  "players", // the global identity
  "schema_runs", // unused since Phase 2; dropped in a later release
  "sms_sends", // sign-in texts
  "tenants",
  // Unused copies from before previews had their own database (Phase 0).
  "pv_arena_after_game",
  "pv_arena_challenges",
  "pv_arena_code_attempts",
  "pv_arena_codes",
  "pv_arena_pair_members",
  "pv_arena_pairs",
  "pv_arena_player_ranks",
  "pv_wv_labels",
  "pv_wv_models",
  "pv_wv_passes",
  "pv_wv_updates",
] as const;

export type ClubOwnedTable = (typeof CLUB_OWNED_TABLES)[number];

/**
 * Tables that used to find their person by email alone and now also carry
 * user_id (Phase 3 step 3). The email stays as the contact field; a row for
 * someone without an account has no user_id. Database triggers keep the link
 * in step (migration 0005), whichever app version writes the row.
 */
export const EMAIL_LINKED_TABLES = [
  "attendance",
  "bookings",
  "casual_play_profiles",
  "day_requests",
  "donations",
  "jersey_registrations",
  "memberships",
  "player_absences",
  "session_fill_ins",
  "waitlist",
] as const;
