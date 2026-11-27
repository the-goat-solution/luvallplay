// Drizzle schema of the production database (public schema).
//
// Generated with `drizzle-kit pull` from a database built by the baseline
// migration (db/migrations/0000_baseline.sql), then corrected for three known
// pull bugs: empty-string defaults, wrong index operator classes, and
// composite keys listed in alphabetical instead of real column order. Column
// names are kept as in SQL (snake_case), so rows look exactly like the raw
// queries' rows.
//
// The schema drift check (tests/schema-drift.test.ts) proves a database built
// from this file alone equals docs/schema/production.sql, and that Drizzle
// Kit sees nothing to migrate. Change the schema here, then
// `npx drizzle-kit generate` for the migration (see db/README.md).
import { pgTable, numeric, index, check, bigserial, timestamp, integer, text, jsonb, foreignKey, unique, serial, uniqueIndex, date, boolean, smallint, bigint, real, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const admin_audit_log = pgTable("admin_audit_log", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	actor_player_id: integer(),
	actor_kind: text().notNull(),
	action: text().notNull(),
	target: text(),
	meta: jsonb().default({}).notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("admin_audit_log_at").using("btree", table.at.desc().nullsFirst()),
	check("admin_audit_log_actor_kind_check", sql`actor_kind = ANY (ARRAY['player'::text, 'break-glass'::text, 'script'::text, 'system'::text])`),
]);

export const admin_handoffs = pgTable("admin_handoffs", {
	id: serial().primaryKey().notNull(),
	token_hash: text().notNull(),
	player_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	used_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "admin_handoffs_player_id_fkey"
		}).onDelete("restrict"),
	unique("admin_handoffs_token_hash_key").on(table.token_hash),
]);

export const admin_invites = pgTable("admin_invites", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	role: text().notNull(),
	invited_by: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accepted_at: timestamp({ withTimezone: true, mode: 'string' }),
	accepted_player_id: integer(),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// One per club.
	uniqueIndex("admin_invites_one_pending").using("btree", table.tenant_id.asc().nullsLast(), table.email.asc().nullsLast()).where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
	check("admin_invites_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text])`),
]);

export const api_tokens = pgTable("api_tokens", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	name: text().notNull(),
	scopes: text().array().notNull(),
	token_hash: text().notNull(),
	prefix: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_used_at: timestamp({ withTimezone: true, mode: 'string' }),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "api_tokens_player_id_fkey"
		}).onDelete("restrict"),
	unique("api_tokens_token_hash_key").on(table.token_hash),
]);

export const arena_challenges = pgTable("arena_challenges", {
	id: serial().primaryKey().notNull(),
	posting_pair: integer().notNull(),
	p1: integer().notNull(),
	p2: integer().notNull(),
	accepting_pair: integer(),
	a1: integer(),
	a2: integer(),
	note: text(),
	status: text().default('open').notNull(),
	available_until: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	posted_by: integer().notNull(),
	posted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accepted_by: integer(),
	accepted_at: timestamp({ withTimezone: true, mode: 'string' }),
	called_off_by: integer(),
	checked_in_at: timestamp({ withTimezone: true, mode: 'string' }),
	played_on: date(),
	score_posting: integer(),
	score_accepting: integer(),
	retired_by: text(),
	entered_by: integer(),
	entered_at: timestamp({ withTimezone: true, mode: 'string' }),
	confirmed_by: integer(),
	auto_confirmed: boolean().default(false).notNull(),
	disputed_by: integer(),
	disputed_at: timestamp({ withTimezone: true, mode: 'string' }),
	dispute_note: text(),
	resolved_by_admin: boolean().default(false).notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	void_reason: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	uniqueIndex("arena_challenges_one_open").using("btree", table.posting_pair.asc().nullsLast()).where(sql`(status = 'open'::text)`),
	index("arena_challenges_status").using("btree", table.status.asc().nullsLast()),
]);

export const arena_code_attempts = pgTable("arena_code_attempts", {
	player_id: integer().notNull(),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const arena_codes = pgTable("arena_codes", {
	id: serial().primaryKey().notNull(),
	purpose: text().notNull(),
	code_hash: text().notNull(),
	owner_id: integer().notNull(),
	challenge_id: integer(),
	status: text().default('live').notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	consumed_by: integer(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("arena_codes_hash").using("btree", table.purpose.asc().nullsLast(), table.code_hash.asc().nullsLast()).where(sql`(status = 'live'::text)`),
]);

export const arena_match_stats = pgTable("arena_match_stats", {
	challenge_id: integer().primaryKey().notNull(),
	recorded_by: integer().notNull(),
	stats: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('final').notNull(),
	live: jsonb(),
	live_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const arena_pairs = pgTable("arena_pairs", {
	id: serial().primaryKey().notNull(),
	player_low: integer().notNull(),
	player_high: integer().notNull(),
	name: text(),
	formed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ended_at: timestamp({ withTimezone: true, mode: 'string' }),
	ended_reason: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const arena_player_ranks = pgTable("arena_player_ranks", {
	player_id: integer().notNull(),
	seen_index: integer().default(0).notNull(),
	peak_index: integer().default(0).notNull(),
	was_tarnished: boolean().default(false).notNull(),
	polished_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.player_id], name: "arena_player_ranks_pkey"}),
]);

export const auth_codes = pgTable("auth_codes", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	code_hash: text().notNull(),
	link_token_hash: text().notNull(),
	attempts: integer().default(0).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	ip_hash: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("auth_codes_email_idx").using("btree", table.email.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	unique("auth_codes_link_token_hash_key").on(table.link_token_hash),
]);

export const bank_rules = pgTable("bank_rules", {
	id: serial().primaryKey().notNull(),
	pattern: text().notNull(),
	direction: text().notNull(),
	action: text().notNull(),
	status: text(),
	category: text(),
	name: text(),
	method: text(),
	person: text(),
	auto: boolean().default(false).notNull(),
	hits: integer().default(0).notNull(),
	last_used_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	unique("bank_rules_pattern_direction_key").on(table.tenant_id, table.pattern, table.direction),
	check("bank_rules_action_check", sql`action = ANY (ARRAY['create'::text, 'classify'::text])`),
	check("bank_rules_direction_check", sql`direction = ANY (ARRAY['in'::text, 'out'::text])`),
]);

export const bookings = pgTable("bookings", {
	id: serial().primaryKey().notNull(),
	session_date: date().notNull(),
	first_name: text().notNull(),
	last_name: text().notNull(),
	email: text().notNull(),
	phone: text(),
	payment_intent_id: text(),
	status: text().default('pending').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reminder_sent_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	index("bookings_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "bookings_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.tenant_id, table.session_date],
			foreignColumns: [sessions.tenant_id, sessions.date],
			name: "bookings_session_date_fkey"
		}),
	unique("bookings_payment_intent_id_key").on(table.payment_intent_id),
]);

export const cancellation_feedback = pgTable("cancellation_feedback", {
	id: serial().primaryKey().notNull(),
	player_id: integer(),
	membership_id: integer(),
	action: text().notNull(),
	reason: text().notNull(),
	comment: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "cancellation_feedback_player_id_fkey"
		}).onDelete("restrict"),
]);

export const club_roles = pgTable("club_roles", {
	player_id: integer().notNull(),
	role: text().notNull(),
	granted_by: integer(),
	granted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.player_id], name: "club_roles_pkey"}),
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "club_roles_player_id_fkey"
		}).onDelete("restrict"),
	check("club_roles_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text])`),
]);

export const casual_play_profiles = pgTable("casual_play_profiles", {
	email: text().notNull(),
	tier: smallint(),
	nickname: text(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.email], name: "casual_play_profiles_pkey"}),
	index("casual_play_profiles_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "casual_play_profiles_user_id_fkey"
		}).onDelete("restrict"),
]);

export const casual_play_sessions = pgTable("casual_play_sessions", {
	date: date().notNull(),
	state: jsonb().notNull(),
	version: integer().default(1).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.date], name: "casual_play_sessions_pkey"}),
]);

export const day_requests = pgTable("day_requests", {
	id: serial().primaryKey().notNull(),
	day: text().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notified_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	// One per club.
	uniqueIndex("day_requests_pending_idx").using("btree", table.tenant_id.asc().nullsLast(), table.day.asc().nullsLast(), sql`lower(email)`).where(sql`(notified_at IS NULL)`),
	index("day_requests_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "day_requests_user_id_fkey"
		}).onDelete("restrict"),
]);

export const day_signup_settings = pgTable("day_signup_settings", {
	day: text().notNull(),
	paused: boolean().default(false).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.day], name: "day_signup_settings_pkey"}),
]);

export const donations = pgTable("donations", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	first_name: text().notNull(),
	last_name: text().notNull(),
	amount_cents: integer().notNull(),
	frequency: text().default('once').notNull(),
	stripe_payment_intent_id: text(),
	stripe_subscription_id: text(),
	status: text().default('pending').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	index("donations_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "donations_user_id_fkey"
		}).onDelete("restrict"),
	unique("donations_stripe_payment_intent_id_key").on(table.stripe_payment_intent_id),
	unique("donations_stripe_subscription_id_key").on(table.stripe_subscription_id),
]);

export const bank_transactions = pgTable("bank_transactions", {
	id: serial().primaryKey().notNull(),
	source: text().notNull(),
	external_id: text().notNull(),
	account: text(),
	txn_date: date().notNull(),
	description: text().default('').notNull(),
	reference: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_cents: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	balance_cents: bigint({ mode: "number" }),
	status: text().default('unmatched').notNull(),
	entry_id: integer(),
	payout_id: text(),
	auto_matched: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	match_reason: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("bank_transactions_date_idx").using("btree", table.txn_date.asc().nullsLast()),
	foreignKey({
			columns: [table.entry_id],
			foreignColumns: [finance_entries.id],
			name: "bank_transactions_entry_id_fkey"
		}).onDelete("set null"),
	unique("bank_transactions_entry_id_key").on(table.entry_id),
	unique("bank_transactions_external_id_key").on(table.external_id),
	check("bank_transactions_status_check", sql`status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'stripe_payout'::text, 'cash_deposit'::text, 'cash_withdrawal'::text, 'internal'::text, 'ignored'::text])`),
]);

export const messages = pgTable("messages", {
	id: serial().primaryKey().notNull(),
	thread_id: integer().notNull(),
	sender: text().notNull(),
	body: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("messages_thread_idx").using("btree", table.thread_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	foreignKey({
			columns: [table.thread_id],
			foreignColumns: [message_threads.id],
			name: "messages_thread_id_fkey"
		}).onDelete("cascade"),
	check("messages_sender_check", sql`sender = ANY (ARRAY['player'::text, 'admin'::text])`),
]);

export const message_threads = pgTable("message_threads", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	subject: text().notNull(),
	status: text().default('open').notNull(),
	started_by: text().default('player').notNull(),
	last_message_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	unread_for_admin: boolean().default(false).notNull(),
	unread_for_player: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("message_threads_player_idx").using("btree", table.player_id.asc().nullsLast(), table.last_message_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "message_threads_player_id_fkey"
		}).onDelete("restrict"),
	check("message_threads_status_check", sql`status = ANY (ARRAY['open'::text, 'closed'::text])`),
]);

export const finance_settings = pgTable("finance_settings", {
	key: text().notNull(),
	value: jsonb().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.key], name: "finance_settings_pkey"}),
]);

export const finance_sync_state = pgTable("finance_sync_state", {
	key: text().notNull(),
	last_started_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_finished_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_error: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.key], name: "finance_sync_state_pkey"}),
]);

export const jersey_registrations = pgTable("jersey_registrations", {
	id: serial().primaryKey().notNull(),
	ref_code: text(),
	first_name: text().notNull(),
	last_name: text().notNull(),
	email: text().notNull(),
	email_normalized: text().notNull(),
	phone: text().notNull(),
	phone_normalized: text().notNull(),
	name_normalized: text().notNull(),
	size: text().notNull(),
	print_name: text(),
	print_number: integer(),
	price_cents: integer().notNull(),
	early_bird: boolean().notNull(),
	status: text().default('pending').notNull(),
	paid_cents: integer(),
	paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	paid_by: text(),
	bank_txn_id: integer(),
	entry_id: integer(),
	ip_hash: text(),
	device_id: text(),
	flags: text().array().default(sql`'{}'::text[]`).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lang: text().default('en').notNull(),
	print_country: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	// One per club.
	uniqueIndex("jersey_one_per_email").using("btree", table.tenant_id.asc().nullsLast(), table.email_normalized.asc().nullsLast()).where(sql`(status = ANY (ARRAY['pending'::text, 'paid'::text]))`),
	index("jersey_registrations_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "jersey_registrations_user_id_fkey"
		}).onDelete("restrict"),
	unique("jersey_registrations_ref_code_key").on(table.ref_code),
	check("jersey_registrations_status_check", sql`status = ANY (ARRAY['pending'::text, 'paid'::text, 'released'::text, 'cancelled'::text])`),
]);

export const memberships = pgTable("memberships", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	plan: text().notNull(),
	stripe_subscription_id: text(),
	status: text().default('active').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	first_name: text(),
	last_name: text(),
	phone: text(),
	period_start: date(),
	period_end: date(),
	cancel_at_period_end: boolean().default(false).notNull(),
	recurring: boolean().default(true).notNull(),
	stripe_payment_intent_id: text(),
	last_renewal_invoice_id: text(),
	day: text().default('friday').notNull(),
	renewal_token: text(),
	renewal_reminder_sent_at: timestamp({ withTimezone: true, mode: 'string' }),
	renewal_of: integer(),
	free_days_granted: integer().default(0).notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	index("memberships_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "memberships_user_id_fkey"
		}).onDelete("restrict"),
	unique("memberships_renewal_token_key").on(table.renewal_token),
	unique("memberships_stripe_payment_intent_id_key").on(table.stripe_payment_intent_id),
	unique("memberships_stripe_subscription_id_key").on(table.stripe_subscription_id),
]);

export const mini_game_draws = pgTable("mini_game_draws", {
	id: serial().primaryKey().notNull(),
	teams: jsonb().notNull(),
	matches: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	locked_until: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	archived_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// One per club.
	uniqueIndex("mini_game_draws_one_active").using("btree", table.tenant_id.asc().nullsLast()).where(sql`(archived_at IS NULL)`),
]);

export const finance_entries = pgTable("finance_entries", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	name: text().notNull(),
	category: text().notNull(),
	method: text(),
	person: text(),
	entry_date: date().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_cents: bigint({ mode: "number" }).notNull(),
	notes: text(),
	origin: text().default('manual').notNull(),
	external_id: text(),
	external_url: text(),
	receipt_url: text(),
	receipt_access: text(),
	receipt_content_type: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("finance_entries_date_idx").using("btree", table.entry_date.asc().nullsLast()),
	unique("finance_entries_external_id_key").on(table.external_id),
	check("finance_entries_amount_cents_check", sql`amount_cents > 0`),
	check("finance_entries_kind_check", sql`kind = ANY (ARRAY['received'::text, 'spent'::text])`),
	check("finance_entries_origin_check", sql`origin = ANY (ARRAY['manual'::text, 'stripe'::text])`),
]);

export const player_photos = pgTable("player_photos", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	original_url: text().notNull(),
	display_url: text().notNull(),
	thumb_url: text().notNull(),
	width: integer(),
	height: integer(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytes: bigint({ mode: "number" }).default(0).notNull(),
	status: text().default('pending').notNull(),
	safesearch: jsonb(),
	caption: text(),
	featured: boolean().default(false).notNull(),
	// The "share this in the Gallery" tick. Empty only for a post's or a listing's photo (0024).
	consent_at: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_by: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deleted_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// 0024: what the photo is for. Only 'gallery' photos join the Gallery.
	purpose: text().default('gallery').notNull(),
}, (table) => [
	index("player_photos_player_idx").using("btree", table.player_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("player_photos_status_idx").using("btree", table.status.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	// 0024: one stored file is one photo, for posts and listings (not the Gallery's rows).
	uniqueIndex("player_photos_file_key").using("btree", table.display_url.asc().nullsLast()).where(sql`(purpose <> 'gallery'::text)`),
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "player_photos_player_id_fkey"
		}).onDelete("restrict"),
	check("player_photos_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'needs_review'::text, 'rejected'::text, 'hidden'::text])`),
	check("player_photos_purpose_check", sql`purpose = ANY (ARRAY['gallery'::text, 'social'::text, 'market'::text])`),
	check("player_photos_gallery_consent_check", sql`(purpose <> 'gallery'::text) OR (consent_at IS NOT NULL)`),
]);

export const player_sessions = pgTable("player_sessions", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	token_hash: text().notNull(),
	user_agent: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_seen_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "player_sessions_player_id_fkey"
		}).onDelete("restrict"),
	unique("player_sessions_token_hash_key").on(table.token_hash),
]);

// Phase 5 step 6: a person's phones that asked for notifications. Platform-wide
// (an account's, not a club's). The address is sealed by the application.
export const push_devices = pgTable("push_devices", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	platform: text().notNull(),
	// SHA-256 (hex) of the device's address.
	token_hash: text().notNull(),
	// The address, encrypted by the application. Never plain text.
	sealed: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_seen_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("push_devices_player_id_idx").using("btree", table.player_id.asc().nullsLast()),
	foreignKey({ columns: [table.player_id], foreignColumns: [players.id], name: "push_devices_player_id_fkey" }).onDelete("restrict"),
	unique("push_devices_token_hash_key").on(table.token_hash),
	check("push_devices_platform_check", sql`platform = ANY (ARRAY['android'::text, 'ios'::text])`),
	check("push_devices_token_hash_check", sql`token_hash ~ '^[0-9a-f]{64}$'::text`),
	check("push_devices_sealed_check", sql`sealed ~ '^v1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'::text`),
]);

// Which kinds of notification a person asked for (no row = don't send).
export const push_prefs = pgTable("push_prefs", {
	player_id: integer().notNull(),
	category: text().notNull(),
	enabled: boolean().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.player_id], foreignColumns: [players.id], name: "push_prefs_player_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.player_id, table.category], name: "push_prefs_pkey" }),
	check("push_prefs_category_check", sql`category = ANY (ARRAY['challenge'::text, 'result'::text, 'message'::text, 'reminder'::text, 'roster'::text, 'payment'::text])`),
]);

export const player_settings = pgTable("player_settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const pv_arena_challenges = pgTable("pv_arena_challenges", {
	id: serial().primaryKey().notNull(),
	posting_pair: integer().notNull(),
	p1: integer().notNull(),
	p2: integer().notNull(),
	accepting_pair: integer(),
	a1: integer(),
	a2: integer(),
	note: text(),
	status: text().default('open').notNull(),
	available_until: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	posted_by: integer().notNull(),
	posted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accepted_by: integer(),
	accepted_at: timestamp({ withTimezone: true, mode: 'string' }),
	called_off_by: integer(),
	checked_in_at: timestamp({ withTimezone: true, mode: 'string' }),
	played_on: date(),
	score_posting: integer(),
	score_accepting: integer(),
	retired_by: text(),
	entered_by: integer(),
	entered_at: timestamp({ withTimezone: true, mode: 'string' }),
	confirmed_by: integer(),
	auto_confirmed: boolean().default(false).notNull(),
	disputed_by: integer(),
	disputed_at: timestamp({ withTimezone: true, mode: 'string' }),
	dispute_note: text(),
	resolved_by_admin: boolean().default(false).notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	void_reason: text(),
}, (table) => [
	uniqueIndex("pv_arena_challenges_one_open").using("btree", table.posting_pair.asc().nullsLast()).where(sql`(status = 'open'::text)`),
	index("pv_arena_challenges_status").using("btree", table.status.asc().nullsLast()),
]);

export const pv_arena_code_attempts = pgTable("pv_arena_code_attempts", {
	player_id: integer().notNull(),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const pv_arena_codes = pgTable("pv_arena_codes", {
	id: serial().primaryKey().notNull(),
	purpose: text().notNull(),
	code_hash: text().notNull(),
	owner_id: integer().notNull(),
	challenge_id: integer(),
	status: text().default('live').notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	consumed_by: integer(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pv_arena_codes_hash").using("btree", table.purpose.asc().nullsLast(), table.code_hash.asc().nullsLast()).where(sql`(status = 'live'::text)`),
]);

export const players = pgTable("players", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	first_name: text().default('').notNull(),
	last_name: text().default('').notNull(),
	display_name: text(),
	phone: text(),
	phone_e164: text(),
	phone_verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	lang: text().default('en').notNull(),
	stripe_customer_id: text(),
	leaderboard_visible: boolean().default(true).notNull(),
	minigame_name: text(),
	avatar_url: text(),
	created_via: text().default('signup').notNull(),
	claimed_at: timestamp({ withTimezone: true, mode: 'string' }),
	welcome_sent_at: timestamp({ withTimezone: true, mode: 'string' }),
	welcome_card_dismissed_at: timestamp({ withTimezone: true, mode: 'string' }),
	install_hint_shown_at: timestamp({ withTimezone: true, mode: 'string' }),
	installed_at: timestamp({ withTimezone: true, mode: 'string' }),
	leaderboard_optout_token: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deleted_at: timestamp({ withTimezone: true, mode: 'string' }),
	// The phone number sealed for this person, and a keyed index of it
	// (apps/web/lib/pii/contact.ts; migration players_contact_sealed, which
	// also adds the trigger that clears these when phone_e164 changes or is
	// empty). The three are set and cleared together (the second check below).
	phone_sealed: text(),
	phone_index: text(),
	phone_index_kid: text(),
}, (table) => [
	uniqueIndex("players_minigame_name_idx").using("btree", sql`lower(minigame_name)`).where(sql`(minigame_name IS NOT NULL)`),
	uniqueIndex("players_phone_index_verified").using("btree", table.phone_index.asc().nullsLast()).where(sql`((phone_verified_at IS NOT NULL) AND (deleted_at IS NULL))`),
	uniqueIndex("players_phone_verified_idx").using("btree", table.phone_e164.asc().nullsLast()).where(sql`((phone_verified_at IS NOT NULL) AND (deleted_at IS NULL))`),
	unique("players_email_key").on(table.email),
	unique("players_leaderboard_optout_token_key").on(table.leaderboard_optout_token),
	check("players_phone_sealed_check", sql`phone_sealed ~ '^v1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'::text`),
	check("players_phone_sealed_together_check", sql`((phone_sealed IS NULL) = (phone_index IS NULL)) AND ((phone_index IS NULL) = (phone_index_kid IS NULL))`),
]);

export const platform_admins = pgTable("platform_admins", {
	player_id: integer().primaryKey().notNull(),
	granted_by: integer(),
	granted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "platform_admins_player_id_fkey"
		}).onDelete("restrict"),
]);

export const player_events = pgTable("player_events", {
	id: serial().primaryKey().notNull(),
	player_id: integer(),
	event: text().notNull(),
	detail: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "player_events_player_id_fkey"
		}).onDelete("restrict"),
]);

export const pv_arena_pairs = pgTable("pv_arena_pairs", {
	id: serial().primaryKey().notNull(),
	player_low: integer().notNull(),
	player_high: integer().notNull(),
	name: text(),
	formed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ended_at: timestamp({ withTimezone: true, mode: 'string' }),
	ended_reason: text(),
});

export const pv_arena_player_ranks = pgTable("pv_arena_player_ranks", {
	player_id: integer().primaryKey().notNull(),
	seen_index: integer().default(0).notNull(),
	peak_index: integer().default(0).notNull(),
	was_tarnished: boolean().default(false).notNull(),
	polished_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const pv_wv_labels = pgTable("pv_wv_labels", {
	id: serial().primaryKey().notNull(),
	player_id: integer(),
	video_name: text().notNull(),
	duration: real(),
	hits: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const pv_wv_models = pgTable("pv_wv_models", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	weights: jsonb().notNull(),
	n: integer().notNull(),
	sessions: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const pv_wv_passes = pgTable("pv_wv_passes", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	kind: text().notNull(),
	status: text().default('pending').notNull(),
	amount_cents: integer().notNull(),
	test: boolean().default(false).notNull(),
	stripe_session: text(),
	challenge_id: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	used_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("pv_wv_passes_player").using("btree", table.player_id.asc().nullsLast(), table.status.asc().nullsLast()),
	unique("pv_wv_passes_stripe_session_key").on(table.stripe_session),
]);

export const pv_wv_updates = pgTable("pv_wv_updates", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	weights: jsonb().notNull(),
	n: integer().notNull(),
	player_id: integer(),
	meta: jsonb(),
	merged: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const session_fill_ins = pgTable("session_fill_ins", {
	id: serial().primaryKey().notNull(),
	session_date: date().notNull(),
	membership_id: integer(),
	booking_id: integer(),
	first_name: text().notNull(),
	last_name: text().notNull(),
	email: text().notNull(),
	phone: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	index("session_fill_ins_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "session_fill_ins_user_id_fkey"
		}).onDelete("restrict"),
	uniqueIndex("session_fill_ins_booking_idx").using("btree", table.session_date.asc().nullsLast(), table.booking_id.asc().nullsLast()).where(sql`(booking_id IS NOT NULL)`),
	uniqueIndex("session_fill_ins_membership_idx").using("btree", table.session_date.asc().nullsLast(), table.membership_id.asc().nullsLast()).where(sql`(membership_id IS NOT NULL)`),
	check("session_fill_ins_one_target", sql`(membership_id IS NULL) <> (booking_id IS NULL)`),
]);

export const session_alert_state = pgTable("session_alert_state", {
	session_date: date().notNull(),
	state: text().default('ok').notNull(),
	headcount: integer().default(0).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.session_date], name: "session_alert_state_pkey"}),
	foreignKey({
			columns: [table.tenant_id, table.session_date],
			foreignColumns: [sessions.tenant_id, sessions.date],
			name: "session_alert_state_session_date_fkey"
		}),
]);

export const sessions = pgTable("sessions", {
	date: date().notNull(),
	max_spots: integer().default(8).notNull(),
	booked_spots: integer().default(0).notNull(),
	google_event_id: text(),
	calendar_summary: text(),
	event_start_time: timestamp({ withTimezone: true, mode: 'string' }),
	synced_at: timestamp({ withTimezone: true, mode: 'string' }),
	event_end_time: timestamp({ withTimezone: true, mode: 'string' }),
	event_location: text(),
	courts: integer().default(2).notNull(),
	registration_locked: boolean().default(false).notNull(),
	mini_game: boolean().default(false).notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.date], name: "sessions_pkey"}),
]);

export const waitlist = pgTable("waitlist", {
	id: serial().primaryKey().notNull(),
	session_date: date(),
	name: text().notNull(),
	email: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notified_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	index("waitlist_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "waitlist_user_id_fkey"
		}).onDelete("restrict"),
]);

export const shop_products = pgTable("shop_products", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	kind: text().default('merch').notNull(),
	name_en: text().notNull(),
	name_vi: text().default('').notNull(),
	desc_en: text().default('').notNull(),
	desc_vi: text().default('').notNull(),
	price_cents: integer().notNull(),
	images: jsonb().default([]).notNull(),
	has_fit: boolean().default(true).notNull(),
	has_sizes: boolean().default(true).notNull(),
	size_chart_men: text(),
	size_chart_women: text(),
	active: boolean().default(true).notNull(),
	sort: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	unique("shop_products_slug_key").on(table.tenant_id, table.slug),
]);

export const webhook_endpoints = pgTable("webhook_endpoints", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	url: text().notNull(),
	secret: text().notNull(),
	events: text().array().notNull(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_status: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "webhook_endpoints_player_id_fkey"
		}).onDelete("restrict"),
]);

export const shop_stock_log = pgTable("shop_stock_log", {
	id: serial().primaryKey().notNull(),
	variant_id: integer().notNull(),
	change: text().notNull(),
	stock_after: integer().notNull(),
	by_whom: text().default('admin').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const webhook_deliveries = pgTable("webhook_deliveries", {
	id: serial().primaryKey().notNull(),
	endpoint_id: integer().notNull(),
	event: text().notNull(),
	payload: jsonb().notNull(),
	status: text().default('pending').notNull(),
	attempts: integer().default(0).notNull(),
	last_error: text(),
	next_attempt_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	delivered_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("webhook_deliveries_due_idx").using("btree", table.status.asc().nullsLast(), table.next_attempt_at.asc().nullsLast()),
	foreignKey({
			columns: [table.endpoint_id],
			foreignColumns: [webhook_endpoints.id],
			name: "webhook_deliveries_endpoint_id_fkey"
		}).onDelete("cascade"),
	check("webhook_deliveries_status_check", sql`status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text])`),
]);

// Lane H (audit H6): one counter per limited thing, shared by every server
// instance. key_hash is a SHA-256: no address or email is stored.
export const rate_limits = pgTable("rate_limits", {
	key_hash: text().primaryKey().notNull(),
	count: integer().notNull(),
	reset_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("rate_limits_reset_at_idx").using("btree", table.reset_at.asc().nullsLast()),
]);

export const sms_sends = pgTable("sms_sends", {
	id: serial().primaryKey().notNull(),
	purpose: text().notNull(),
	phone_hash: text().notNull(),
	ip_hash: text(),
	sent_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sms_sends_sent_at_idx").using("btree", table.sent_at.asc().nullsLast()),
]);

// Lane H (audit H3): Stripe events handled to the end, so one delivered
// again is skipped.
export const stripe_events = pgTable("stripe_events", {
	event_id: text().primaryKey().notNull(),
	type: text().notNull(),
	processed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("stripe_events_processed_at_idx").using("btree", table.processed_at.asc().nullsLast()),
]);

export const stripe_payouts = pgTable("stripe_payouts", {
	id: text().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_cents: bigint({ mode: "number" }).notNull(),
	created_date: date().notNull(),
	arrival_date: date().notNull(),
	status: text(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const shop_orders = pgTable("shop_orders", {
	id: serial().primaryKey().notNull(),
	player_id: integer(),
	email: text().notNull(),
	name: text().default('').notNull(),
	status: text().notNull(),
	payment_method: text().notNull(),
	total_cents: integer().notNull(),
	stripe_payment_intent_id: text(),
	cash_invoice_id: text(),
	hold_expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	reminder_sent_at: timestamp({ withTimezone: true, mode: 'string' }),
	paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	collected_at: timestamp({ withTimezone: true, mode: 'string' }),
	cancelled_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.player_id],
			foreignColumns: [players.id],
			name: "shop_orders_player_id_fkey"
		}).onDelete("restrict"),
	unique("shop_orders_stripe_payment_intent_id_key").on(table.stripe_payment_intent_id),
	check("shop_orders_payment_method_check", sql`payment_method = ANY (ARRAY['card'::text, 'cash'::text])`),
	check("shop_orders_status_check", sql`status = ANY (ARRAY['pending_payment'::text, 'reserved_cash'::text, 'paid'::text, 'collected'::text, 'cancelled'::text, 'expired'::text, 'refunded'::text])`),
]);

export const shop_variants = pgTable("shop_variants", {
	id: serial().primaryKey().notNull(),
	product_id: integer().notNull(),
	fit: text().notNull(),
	size: text().notNull(),
	stock: integer().default(0).notNull(),
	reserved: integer().default(0).notNull(),
	sold: integer().default(0).notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.product_id],
			foreignColumns: [shop_products.id],
			name: "shop_variants_product_id_fkey"
		}).onDelete("cascade"),
	unique("shop_variants_product_id_fit_size_key").on(table.product_id, table.fit, table.size),
	check("shop_variants_reserved_check", sql`reserved >= 0`),
	check("shop_variants_stock_check", sql`stock >= 0`),
]);

export const wv_labels = pgTable("wv_labels", {
	id: serial().primaryKey().notNull(),
	player_id: integer(),
	video_name: text().notNull(),
	duration: real(),
	hits: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const wv_models = pgTable("wv_models", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	weights: jsonb().notNull(),
	n: integer().notNull(),
	sessions: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const wv_passes = pgTable("wv_passes", {
	id: serial().primaryKey().notNull(),
	player_id: integer().notNull(),
	kind: text().notNull(),
	status: text().default('pending').notNull(),
	amount_cents: integer().notNull(),
	test: boolean().default(false).notNull(),
	stripe_session: text(),
	challenge_id: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	paid_at: timestamp({ withTimezone: true, mode: 'string' }),
	used_at: timestamp({ withTimezone: true, mode: 'string' }),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("wv_passes_player").using("btree", table.player_id.asc().nullsLast(), table.status.asc().nullsLast()),
	unique("wv_passes_stripe_session_key").on(table.stripe_session),
]);

export const wv_updates = pgTable("wv_updates", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	weights: jsonb().notNull(),
	n: integer().notNull(),
	player_id: integer(),
	meta: jsonb(),
	merged: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
});

export const shop_order_items = pgTable("shop_order_items", {
	id: serial().primaryKey().notNull(),
	order_id: integer().notNull(),
	product_id: integer().notNull(),
	variant_id: integer().notNull(),
	qty: integer().notNull(),
	unit_price_cents: integer().notNull(),
	label: text().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.order_id],
			foreignColumns: [shop_orders.id],
			name: "shop_order_items_order_id_fkey"
		}).onDelete("cascade"),
]);

export const arena_pair_members = pgTable("arena_pair_members", {
	pair_id: integer().notNull(),
	player_id: integer().notNull(),
	active: boolean().default(true).notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// One per club.
	uniqueIndex("arena_pair_members_one_active").using("btree", table.tenant_id.asc().nullsLast(), table.player_id.asc().nullsLast()).where(sql`active`),
	primaryKey({ columns: [table.pair_id, table.player_id], name: "arena_pair_members_pkey"}),
]);

export const membership_reminders_sent = pgTable("membership_reminders_sent", {
	membership_id: integer().notNull(),
	session_date: date().notNull(),
	sent_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	primaryKey({ columns: [table.membership_id, table.session_date], name: "membership_reminders_sent_pkey"}),
]);

export const player_absences = pgTable("player_absences", {
	session_date: date().notNull(),
	email: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.session_date, table.email], name: "player_absences_pkey"}),
	index("player_absences_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "player_absences_user_id_fkey"
		}).onDelete("restrict"),
]);

export const pv_arena_pair_members = pgTable("pv_arena_pair_members", {
	pair_id: integer().notNull(),
	player_id: integer().notNull(),
	active: boolean().default(true).notNull(),
}, (table) => [
	uniqueIndex("pv_arena_pair_members_one_active").using("btree", table.player_id.asc().nullsLast()).where(sql`active`),
	primaryKey({ columns: [table.pair_id, table.player_id], name: "pv_arena_pair_members_pkey"}),
]);

export const schema_runs = pgTable("schema_runs", {
	name: text().notNull(),
	deploy: text().notNull(),
	ran_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.name, table.deploy], name: "schema_runs_pkey"}),
]);

export const bank_matches = pgTable("bank_matches", {
	bank_txn_id: integer().notNull(),
	entry_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.bank_txn_id],
			foreignColumns: [bank_transactions.id],
			name: "bank_matches_bank_txn_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.entry_id],
			foreignColumns: [finance_entries.id],
			name: "bank_matches_entry_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.bank_txn_id, table.entry_id], name: "bank_matches_pkey"}),
	unique("bank_matches_entry_id_key").on(table.entry_id),
]);

export const arena_after_game = pgTable("arena_after_game", {
	challenge_id: integer().notNull(),
	player_id: integer().notNull(),
	keep_pair: boolean(),
	again: boolean(),
	answered_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	primaryKey({ columns: [table.challenge_id, table.player_id], name: "arena_after_game_pkey"}),
]);

export const mini_game_scores = pgTable("mini_game_scores", {
	draw_id: integer().notNull(),
	match_id: text().notNull(),
	score_a: integer().notNull(),
	score_b: integer().notNull(),
	locked_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	foreignKey({
			columns: [table.draw_id],
			foreignColumns: [mini_game_draws.id],
			name: "mini_game_scores_draw_id_fkey"
		}),
	primaryKey({ columns: [table.draw_id, table.match_id], name: "mini_game_scores_pkey"}),
]);

export const pv_arena_after_game = pgTable("pv_arena_after_game", {
	challenge_id: integer().notNull(),
	player_id: integer().notNull(),
	keep_pair: boolean(),
	again: boolean(),
	answered_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.challenge_id, table.player_id], name: "pv_arena_after_game_pkey"}),
]);

export const attendance = pgTable("attendance", {
	session_date: date().notNull(),
	email: text().notNull(),
	source: text().notNull(),
	verified: boolean().default(true).notNull(),
	removed: boolean().default(false).notNull(),
	recorded_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
	// Phase 3 step 3: the account this row belongs to, when there is one. The
	// email stays as the contact field; people without an account have no link.
	user_id: integer(),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.session_date, table.email], name: "attendance_pkey"}),
	index("attendance_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "attendance_user_id_fkey"
		}).onDelete("restrict"),
	index("attendance_email_idx").using("btree", table.email.asc().nullsLast(), table.session_date.asc().nullsLast()),
]);

export const rr_results = pgTable("rr_results", {
	draw_id: integer().notNull(),
	mg_name: text().notNull(),
	session_date: date().notNull(),
	team_id: integer().notNull(),
	wins: integer().notNull(),
	losses: integer().notNull(),
	points_for: integer().notNull(),
	points_against: integer().notNull(),
	rr_points: integer().notNull(),
	finish_place: integer().notNull(),
	teams_count: integer().notNull(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	index("rr_results_name_idx").using("btree", sql`lower(mg_name)`, sql`session_date`),
	primaryKey({ columns: [table.draw_id, table.mg_name], name: "rr_results_pkey"}),
]);

// Business config (Phase 2 PR 6): moved out of Sanity, edited in Admin →
// Settings. Locale fields are { en, vi } objects, as they were in Sanity.
export const pricing_plans = pgTable("pricing_plans", {
	plan_id: text().notNull(),
	name: jsonb().default({}).notNull(),
	description: jsonb().default({}).notNull(),
	price_nzd: numeric({ precision: 10, scale: 2 }),
	period_label: jsonb().default({}).notNull(),
	featured: boolean().default(false).notNull(),
	features: jsonb().default([]).notNull(),
	stripe_price_id: text(),
	sort: integer().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_by: integer(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.plan_id], name: "pricing_plans_pkey"}),
	check("pricing_plans_plan_id_check", sql`plan_id = ANY (ARRAY['casual'::text, 'fridayMonthly'::text, 'fridayQuarterly'::text, 'wednesdayMonthly'::text, 'wednesdayQuarterly'::text])`),
]);

export const club_settings = pgTable("club_settings", {
	key: text().notNull(),
	value: jsonb(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_by: integer(),
	// Phase 3 step 2: the club that owns the row. Nullable with a default until step 10.
	tenant_id: integer().default(sql`COALESCE(app_tenant_id(), 1)`).notNull().references(() => tenants.id, { onDelete: "restrict" }),
}, (table) => [
	// The key is per club.
	primaryKey({ columns: [table.tenant_id, table.key], name: "club_settings_pkey"}),
]);

// ---------------------------------------------------------------------------
// Phase 3: multi-tenant core (build plan §6.1). Additive: nothing above
// changes in this step.
// ---------------------------------------------------------------------------

// A club. Three Wolves is club #1 (migration 0003). Every club lives in
// exactly one region (§6.9); money is minor units in `currency`.
export const tenants = pgTable("tenants", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	status: text().default('active').notNull(),
	country: text().notNull(),
	region: text().notNull(),
	timezone: text().notNull(),
	currency: text().notNull(),
	languages: text().array().default(["en"]).notNull(),
	sports: text().array().default([]).notNull(),
	payment_mode: text().default('free').notNull(),
	incorporated: text().default('unsure').notNull(),
	stripe_status: text().default('none').notNull(),
	bank_details: jsonb(),
	theme: jsonb().default({}).notNull(),
	terms: jsonb().default({}).notNull(),
	custom_domain: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("tenants_slug_key").on(table.slug),
	unique("tenants_custom_domain_key").on(table.custom_domain),
	check("tenants_slug_check", sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text`),
	check("tenants_status_check", sql`status = ANY (ARRAY['setup'::text, 'active'::text, 'suspended'::text, 'closed'::text])`),
	check("tenants_country_check", sql`country ~ '^[A-Z]{2}$'::text`),
	check("tenants_region_check", sql`region ~ '^[a-z][a-z0-9-]*$'::text`),
	check("tenants_currency_check", sql`currency ~ '^[A-Z]{3}$'::text`),
	check("tenants_payment_mode_check", sql`payment_mode = ANY (ARRAY['free'::text, 'offline'::text, 'online'::text])`),
	check("tenants_incorporated_check", sql`incorporated = ANY (ARRAY['yes'::text, 'no'::text, 'unsure'::text])`),
	check("tenants_stripe_status_check", sql`stripe_status = ANY (ARRAY['none'::text, 'connecting'::text, 'connected'::text])`),
	check("tenants_custom_domain_check", sql`custom_domain = lower(custom_domain)`),
]);

// Which modules a club has on (§6.2.3), with each module's settings. Core
// modules have a row too, for their settings; they can't be switched off.
// `locked` is a platform admin's lock: the club's owners can't change it and
// see `lock_reason`.
export const tenant_modules = pgTable("tenant_modules", {
	tenant_id: integer().notNull(),
	module_id: text().notNull(),
	enabled: boolean().default(true).notNull(),
	settings: jsonb().default({}).notNull(),
	enabled_at: timestamp({ withTimezone: true, mode: 'string' }),
	locked: text(),
	lock_reason: text(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_by: integer(),
}, (table) => [
	foreignKey({
			columns: [table.tenant_id],
			foreignColumns: [tenants.id],
			name: "tenant_modules_tenant_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.module_id], name: "tenant_modules_pkey"}),
	check("tenant_modules_locked_check", sql`locked = ANY (ARRAY['on'::text, 'off'::text])`),
]);

// A person's place in a club: one row per club and account. The account
// (players, the global identity) is never deleted, only soft-deleted, so the
// link is ON DELETE RESTRICT. `status` is the club's own decision: a disabled
// member loses that club's spaces and keeps the account and data.
// Until reads switch (Phase 3 step 11), club_roles stays the source for
// owner/admin/coach and this table mirrors it.
export const club_members = pgTable("club_members", {
	tenant_id: integer().notNull(),
	user_id: integer().notNull(),
	role: text().default('member').notNull(),
	status: text().default('active').notNull(),
	joined_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	leaderboard_visible: boolean().default(true).notNull(),
	global_profile_visible: boolean().default(false).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("club_members_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.tenant_id],
			foreignColumns: [tenants.id],
			name: "club_members_tenant_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [players.id],
			name: "club_members_user_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.user_id], name: "club_members_pkey"}),
	check("club_members_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text, 'member'::text, 'guest'::text])`),
	check("club_members_status_check", sql`status = ANY (ARRAY['active'::text, 'disabled'::text])`),
]);

// Junior accounts (§6.8): a child's profile has no login, email or phone. A
// guardian (a normal account) manages it. Created empty in Phase 3 so
// nothing is reshaped later; the features are Phase 3b.
export const junior_profiles = pgTable("junior_profiles", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	// Who created the profile. NOT who may act for the child: that is guardianships.
	guardian_user_id: integer(),
	name: text().notNull(),
	birth_year: smallint(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deleted_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("junior_profiles_guardian_user_id_idx").using("btree", table.guardian_user_id.asc().nullsLast()),
	// A junior's rows must be in the junior's own club: the target of their foreign keys.
	unique("junior_profiles_tenant_id_id_key").on(table.tenant_id, table.id),
	foreignKey({
			columns: [table.tenant_id],
			foreignColumns: [tenants.id],
			name: "junior_profiles_tenant_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.guardian_user_id],
			foreignColumns: [players.id],
			name: "junior_profiles_guardian_user_id_fkey"
		}).onDelete("restrict"),
]);

// Phase 3b: a junior's bookings and attendance. Tables of their own, because
// the adults' tables are keyed by an account's email and everything that
// reads them assumes someone who can be emailed (build plan §6.8).
export const junior_bookings = pgTable("junior_bookings", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	junior_profile_id: integer().notNull(),
	session_date: date().notNull(),
	// The guardian who booked, and who pays. Never the child.
	booked_by_user_id: integer().notNull(),
	payment_intent_id: text(),
	// In the currency's smallest unit, with the currency beside it.
	amount_minor: integer(),
	currency: text(),
	status: text().default('pending').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	cancelled_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("junior_bookings_one_live").using("btree", table.tenant_id.asc().nullsLast(), table.junior_profile_id.asc().nullsLast(), table.session_date.asc().nullsLast()).where(sql`(status = ANY (ARRAY['pending'::text, 'confirmed'::text]))`),
	index("junior_bookings_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	index("junior_bookings_session_idx").using("btree", table.tenant_id.asc().nullsLast(), table.session_date.asc().nullsLast()),
	index("junior_bookings_booked_by_user_id_idx").using("btree", table.booked_by_user_id.asc().nullsLast()),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_bookings_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.junior_profile_id], foreignColumns: [junior_profiles.id], name: "junior_bookings_junior_profile_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "junior_bookings_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.session_date], foreignColumns: [sessions.tenant_id, sessions.date], name: "junior_bookings_session_date_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.booked_by_user_id], foreignColumns: [players.id], name: "junior_bookings_booked_by_user_id_fkey" }).onDelete("restrict"),
	// Whoever booked is (or was) a guardian of this child, in this club.
	foreignKey({ columns: [table.tenant_id, table.booked_by_user_id, table.junior_profile_id], foreignColumns: [guardianships.tenant_id, guardianships.guardian_user_id, guardianships.junior_profile_id], name: "junior_bookings_booked_by_guardian_fkey" }).onDelete("restrict"),
	unique("junior_bookings_payment_intent_id_key").on(table.payment_intent_id),
	check("junior_bookings_status_check", sql`status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'refunded'::text])`),
	check("junior_bookings_amount_check", sql`((amount_minor IS NULL) AND (currency IS NULL)) OR ((amount_minor >= 0) AND (currency ~ '^[A-Z]{3}$'::text))`),
]);

export const junior_attendance = pgTable("junior_attendance", {
	tenant_id: integer().notNull(),
	session_date: date().notNull(),
	junior_profile_id: integer().notNull(),
	source: text().notNull(),
	removed: boolean().default(false).notNull(),
	recorded_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// The coach or admin who marked it.
	recorded_by_user_id: integer(),
}, (table) => [
	index("junior_attendance_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_attendance_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.junior_profile_id], foreignColumns: [junior_profiles.id], name: "junior_attendance_junior_profile_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "junior_attendance_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.recorded_by_user_id], foreignColumns: [players.id], name: "junior_attendance_recorded_by_user_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.session_date], foreignColumns: [sessions.tenant_id, sessions.date], name: "junior_attendance_session_date_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.session_date, table.junior_profile_id], name: "junior_attendance_pkey"}),
	check("junior_attendance_source_check", sql`source = ANY (ARRAY['roster'::text, 'coach'::text, 'admin'::text])`),
]);

// Phase 3b step 4: a club's forms and waivers. The text is never edited: new
// wording is a new version (a new row), so a signature points at exact words.
export const club_forms = pgTable("club_forms", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	// The form's stable name within the club, e.g. "junior-waiver".
	slug: text().notNull(),
	version: integer().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	published_by_user_id: integer().notNull(),
	// Set when the club stops asking for this form. Its signatures are kept.
	retired_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("club_forms_published_by_user_id_idx").using("btree", table.published_by_user_id.asc().nullsLast()),
	unique("club_forms_tenant_id_id_key").on(table.tenant_id, table.id),
	unique("club_forms_one_per_version").on(table.tenant_id, table.slug, table.version),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "club_forms_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.published_by_user_id], foreignColumns: [players.id], name: "club_forms_published_by_user_id_fkey" }).onDelete("restrict"),
	check("club_forms_kind_check", sql`kind = ANY (ARRAY['waiver'::text, 'consent'::text])`),
	check("club_forms_version_check", sql`version >= 1`),
	check("club_forms_slug_check", sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text`),
]);

// Who signed which version of a form, for which child. Never updated.
export const form_signatures = pgTable("form_signatures", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	form_id: integer().notNull(),
	// The child the form was signed for.
	junior_profile_id: integer().notNull(),
	// The guardian who signed, and the name they typed as their signature.
	signed_by_user_id: integer().notNull(),
	signed_name: text().notNull(),
	signed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("form_signatures_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	index("form_signatures_signed_by_user_id_idx").using("btree", table.signed_by_user_id.asc().nullsLast()),
	index("form_signatures_form_idx").using("btree", table.tenant_id.asc().nullsLast(), table.form_id.asc().nullsLast()),
	unique("form_signatures_once").on(table.tenant_id, table.form_id, table.junior_profile_id, table.signed_by_user_id),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "form_signatures_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.form_id], foreignColumns: [club_forms.tenant_id, club_forms.id], name: "form_signatures_form_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.junior_profile_id], foreignColumns: [junior_profiles.id], name: "form_signatures_junior_profile_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "form_signatures_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.signed_by_user_id], foreignColumns: [players.id], name: "form_signatures_signed_by_user_id_fkey" }).onDelete("restrict"),
]);

// Phase 3b step 7: a guardian's request to delete a child's information,
// waiting for the club. Once confirmed it no longer points at a child.
export const junior_deletion_requests = pgTable("junior_deletion_requests", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	// The child, while they exist. NULL once a request for them is confirmed: the child is gone.
	junior_profile_id: integer(),
	// The guardian who asked.
	requested_by_user_id: integer().notNull(),
	requested_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
	// The owner or admin who confirmed, or the guardian who cancelled.
	decided_by_user_id: integer(),
	decided_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("junior_deletion_requests_one_pending").using("btree", table.tenant_id.asc().nullsLast(), table.junior_profile_id.asc().nullsLast()).where(sql`(status = 'pending'::text)`),
	index("junior_deletion_requests_junior_profile_id_idx").using("btree", table.tenant_id.asc().nullsLast(), table.junior_profile_id.asc().nullsLast()),
	index("junior_deletion_requests_requested_by_user_id_idx").using("btree", table.requested_by_user_id.asc().nullsLast()),
	index("junior_deletion_requests_decided_by_user_id_idx").using("btree", table.decided_by_user_id.asc().nullsLast()),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_deletion_requests_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "junior_deletion_requests_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.requested_by_user_id], foreignColumns: [players.id], name: "junior_deletion_requests_requested_by_user_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.decided_by_user_id], foreignColumns: [players.id], name: "junior_deletion_requests_decided_by_user_id_fkey" }).onDelete("restrict"),
	check("junior_deletion_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text])`),
	check("junior_deletion_requests_child_check", sql`((status <> 'pending'::text) OR (junior_profile_id IS NOT NULL)) AND ((status <> 'confirmed'::text) OR (junior_profile_id IS NULL))`),
]);

// What the payment code needs after a child is deleted: that this payment was
// settled for this club, and for how much. No child, no guardian, no play day.
export const junior_payment_records = pgTable("junior_payment_records", {
	tenant_id: integer().notNull(),
	payment_intent_id: text().notNull(),
	amount_minor: integer().notNull(),
	currency: text().notNull(),
	recorded_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_payment_records_tenant_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.payment_intent_id], name: "junior_payment_records_pkey"}),
]);

// Phase 3b step 6: the safety check a club records for a coach or volunteer.
// That a check exists and when it expires: never its document or result.
export const junior_safety_checks = pgTable("junior_safety_checks", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	// The coach or volunteer the check is about.
	user_id: integer().notNull(),
	kind: text().notNull(),
	// The club's own reference for where the record is kept. Optional.
	reference: text(),
	checked_on: date().notNull(),
	expires_on: date().notNull(),
	recorded_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// The owner who recorded it.
	recorded_by_user_id: integer().notNull(),
	// Set when the club withdraws the record before it expires.
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
	revoked_by_user_id: integer(),
}, (table) => [
	index("junior_safety_checks_user_idx").using("btree", table.tenant_id.asc().nullsLast(), table.user_id.asc().nullsLast()),
	index("junior_safety_checks_user_id_idx").using("btree", table.user_id.asc().nullsLast()),
	index("junior_safety_checks_recorded_by_user_id_idx").using("btree", table.recorded_by_user_id.asc().nullsLast()),
	index("junior_safety_checks_revoked_by_user_id_idx").using("btree", table.revoked_by_user_id.asc().nullsLast()),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_safety_checks_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.user_id], foreignColumns: [players.id], name: "junior_safety_checks_user_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.recorded_by_user_id], foreignColumns: [players.id], name: "junior_safety_checks_recorded_by_user_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.revoked_by_user_id], foreignColumns: [players.id], name: "junior_safety_checks_revoked_by_user_id_fkey" }).onDelete("restrict"),
	check("junior_safety_checks_kind_check", sql`kind = ANY (ARRAY['police-vet'::text, 'working-with-children'::text, 'other'::text])`),
	check("junior_safety_checks_dates_check", sql`expires_on > checked_on`),
]);

// Phase 3b step 4: who to call for a child. Club-owned; written by a guardian.
export const junior_emergency_contacts = pgTable("junior_emergency_contacts", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	junior_profile_id: integer().notNull(),
	// 1 is who to call first.
	position: smallint().default(1).notNull(),
	name: text().notNull(),
	phone: text().notNull(),
	relationship: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// The guardian who wrote it.
	updated_by_user_id: integer().notNull(),
}, (table) => [
	index("junior_emergency_contacts_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	index("junior_emergency_contacts_updated_by_user_id_idx").using("btree", table.updated_by_user_id.asc().nullsLast()),
	unique("junior_emergency_contacts_one_per_position").on(table.tenant_id, table.junior_profile_id, table.position),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_emergency_contacts_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.junior_profile_id], foreignColumns: [junior_profiles.id], name: "junior_emergency_contacts_junior_profile_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "junior_emergency_contacts_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.updated_by_user_id], foreignColumns: [players.id], name: "junior_emergency_contacts_updated_by_user_id_fkey" }).onDelete("restrict"),
	check("junior_emergency_contacts_position_check", sql`("position" >= 1) AND ("position" <= 3)`),
]);

// A child's medical note, as sealed text only: encrypted by the application
// (bound to the club and the child) before it reaches the database.
export const junior_medical_notes = pgTable("junior_medical_notes", {
	tenant_id: integer().notNull(),
	junior_profile_id: integer().notNull(),
	// Encrypted by the application. Never plain text.
	sealed: text().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// The guardian who wrote it.
	updated_by_user_id: integer().notNull(),
}, (table) => [
	index("junior_medical_notes_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	index("junior_medical_notes_updated_by_user_id_idx").using("btree", table.updated_by_user_id.asc().nullsLast()),
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "junior_medical_notes_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.junior_profile_id], foreignColumns: [junior_profiles.id], name: "junior_medical_notes_junior_profile_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "junior_medical_notes_junior_in_club_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.updated_by_user_id], foreignColumns: [players.id], name: "junior_medical_notes_updated_by_user_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.junior_profile_id], name: "junior_medical_notes_pkey"}),
	check("junior_medical_notes_sealed_check", sql`sealed ~ '^v1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'::text`),
]);

// One child can have two guardians, one guardian several children. The one
// source of truth for who may act for a child. Club-owned: the child's club.
export const guardianships = pgTable("guardianships", {
	guardian_user_id: integer().notNull(),
	junior_profile_id: integer().notNull(),
	consent_at: timestamp({ withTimezone: true, mode: 'string' }),
	consent_scope: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	tenant_id: integer().notNull(),
	// A guardian who stepped away: the row stays for its history, and gives no access.
	ended_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({ columns: [table.tenant_id], foreignColumns: [tenants.id], name: "guardianships_tenant_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.tenant_id, table.junior_profile_id], foreignColumns: [junior_profiles.tenant_id, junior_profiles.id], name: "guardianships_junior_in_club_fkey" }).onDelete("restrict"),
	unique("guardianships_tenant_guardian_junior_key").on(table.tenant_id, table.guardian_user_id, table.junior_profile_id),
	index("guardianships_junior_profile_id_idx").using("btree", table.junior_profile_id.asc().nullsLast()),
	foreignKey({
			columns: [table.guardian_user_id],
			foreignColumns: [players.id],
			name: "guardianships_guardian_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.junior_profile_id],
			foreignColumns: [junior_profiles.id],
			name: "guardianships_junior_profile_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.guardian_user_id, table.junior_profile_id], name: "guardianships_pkey"}),
]);

// Phase 3 step 9: plans, what each club is on, and usage per club (build
// plan §6.5, §11.2). Platform-wide: what a plan includes, for which country
// and sport, and what it costs (minor units + currency).
export const plans = pgTable("plans", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	country: text(),
	sport: text(),
	tiers: text().array().default(sql`ARRAY['free']::text[]`).notNull(),
	price_minor: integer().default(0).notNull(),
	currency: text().notNull(),
	billing_interval: text(),
	limits: jsonb().default({}).notNull(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("plans_id_check", sql`id ~ '^[a-z][a-z0-9-]*$'::text`),
	check("plans_country_check", sql`country ~ '^[A-Z]{2}$'::text`),
	check("plans_currency_check", sql`currency ~ '^[A-Z]{3}$'::text`),
	check("plans_price_minor_check", sql`price_minor >= 0`),
	check("plans_billing_interval_check", sql`billing_interval = ANY (ARRAY['month'::text, 'year'::text])`),
]);

// Which plan a club is on, and since when. One current row per club (ends_at
// IS NULL); a change of plan closes the row and opens another.
export const club_plans = pgTable("club_plans", {
	id: serial().primaryKey().notNull(),
	tenant_id: integer().notNull(),
	plan_id: text().notNull(),
	status: text().default('active').notNull(),
	starts_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ends_at: timestamp({ withTimezone: true, mode: 'string' }),
	note: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("club_plans_current_idx").using("btree", table.tenant_id.asc().nullsLast().op("int4_ops")).where(sql`(ends_at IS NULL)`),
	index("club_plans_plan_id_idx").using("btree", table.plan_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.tenant_id],
			foreignColumns: [tenants.id],
			name: "club_plans_tenant_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.plan_id],
			foreignColumns: [plans.id],
			name: "club_plans_plan_id_fkey"
		}).onDelete("restrict"),
	check("club_plans_status_check", sql`status = ANY (ARRAY['active'::text, 'trial'::text, 'past_due'::text, 'canceled'::text])`),
	check("club_plans_period_check", sql`ends_at IS NULL OR ends_at > starts_at`),
]);

// One number per club, metric and calendar month (period = the 1st).
export const usage_counters = pgTable("usage_counters", {
	tenant_id: integer().notNull(),
	metric: text().notNull(),
	period: date().notNull(),
	quantity: bigint({ mode: "number" }).default(0).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.tenant_id],
			foreignColumns: [tenants.id],
			name: "usage_counters_tenant_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.tenant_id, table.metric, table.period], name: "usage_counters_pkey"}),
	check("usage_counters_metric_check", sql`metric ~ '^[a-z][a-z0-9_.]*$'::text`),
	check("usage_counters_period_check", sql`EXTRACT(day FROM period) = 1`),
	check("usage_counters_quantity_check", sql`quantity >= 0`),
]);

// ── Social and moderation (lane S; migration 0022). Platform-wide: no
// tenant_id and no row-level security. A row in one club's space says so in
// club_id. ──

// A person's opt-in social profile. public_id is what other people see.
export const social_profiles = pgTable("social_profiles", {
	player_id: integer().primaryKey().notNull(),
	public_id: text().notNull(),
	display_name: text().notNull(),
	bio: text(),
	visibility: text().default('club').notNull(),
	adult_confirmed_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	rules_version: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.player_id], foreignColumns: [players.id], name: "social_profiles_player_id_fkey" }).onDelete("restrict"),
	unique("social_profiles_public_id_key").on(table.public_id),
	check("social_profiles_public_id_check", sql`public_id ~ '^[0-9A-Za-z]{12}$'::text`),
	check("social_profiles_display_name_check", sql`char_length(display_name) BETWEEN 1 AND 40`),
	check("social_profiles_bio_check", sql`char_length(bio) <= 160`),
	check("social_profiles_visibility_check", sql`visibility = ANY (ARRAY['club'::text, 'everyone'::text])`),
	check("social_profiles_rules_version_check", sql`char_length(rules_version) BETWEEN 1 AND 20`),
]);

export const social_follows = pgTable("social_follows", {
	follower_id: integer().notNull(),
	followee_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("social_follows_followee_id_idx").using("btree", table.followee_id.asc().nullsLast()),
	foreignKey({ columns: [table.follower_id], foreignColumns: [players.id], name: "social_follows_follower_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.followee_id], foreignColumns: [players.id], name: "social_follows_followee_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.follower_id, table.followee_id], name: "social_follows_pkey" }),
	check("social_follows_not_self_check", sql`follower_id <> followee_id`),
]);

// A post in one club's space. Automatic posts carry ref_key, unique per author and kind.
export const social_posts = pgTable("social_posts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	author_id: integer().notNull(),
	club_id: integer().notNull(),
	kind: text().notNull(),
	body: text(),
	ref_key: text(),
	photo_id: integer(),
	state: text().default('visible').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("social_posts_created_idx").using("btree", table.created_at.desc().nullsFirst(), table.id.desc().nullsFirst()),
	index("social_posts_club_created_idx").using("btree", table.club_id.asc().nullsLast(), table.created_at.desc().nullsFirst(), table.id.desc().nullsFirst()),
	index("social_posts_author_created_idx").using("btree", table.author_id.asc().nullsLast(), table.created_at.desc().nullsFirst(), table.id.desc().nullsFirst()),
	// One post per side of a match, whoever of the pair writes it.
	uniqueIndex("social_posts_match_ref_key").using("btree", table.ref_key.asc().nullsLast()).where(sql`(kind = 'match'::text)`),
	// 0024: one photo is in at most one post.
	uniqueIndex("social_posts_photo_id_key").using("btree", table.photo_id.asc().nullsLast()).where(sql`(photo_id IS NOT NULL)`),
	foreignKey({ columns: [table.author_id], foreignColumns: [players.id], name: "social_posts_author_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.club_id], foreignColumns: [tenants.id], name: "social_posts_club_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.photo_id], foreignColumns: [player_photos.id], name: "social_posts_photo_id_fkey" }).onDelete("restrict"),
	unique("social_posts_author_kind_ref_key").on(table.author_id, table.kind, table.ref_key),
	check("social_posts_kind_check", sql`kind = ANY (ARRAY['match'::text, 'rank_up'::text, 'photo'::text, 'text'::text])`),
	check("social_posts_state_check", sql`state = ANY (ARRAY['visible'::text, 'held'::text, 'hidden'::text, 'removed'::text])`),
	check("social_posts_body_check", sql`char_length(body) <= 500`),
	check("social_posts_ref_key_check", sql`char_length(ref_key) BETWEEN 1 AND 80`),
	check("social_posts_text_has_body_check", sql`kind <> 'text'::text OR (body IS NOT NULL AND char_length(body) >= 1)`),
	check("social_posts_auto_has_key_check", sql`(kind <> ALL (ARRAY['match'::text, 'rank_up'::text])) OR ref_key IS NOT NULL`),
]);

export const social_comments = pgTable("social_comments", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	post_id: bigint({ mode: "number" }).notNull(),
	author_id: integer().notNull(),
	body: text().notNull(),
	state: text().default('visible').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("social_comments_post_idx").using("btree", table.post_id.asc().nullsLast(), table.created_at.asc().nullsLast(), table.id.asc().nullsLast()),
	index("social_comments_author_id_idx").using("btree", table.author_id.asc().nullsLast()),
	foreignKey({ columns: [table.post_id], foreignColumns: [social_posts.id], name: "social_comments_post_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.author_id], foreignColumns: [players.id], name: "social_comments_author_id_fkey" }).onDelete("restrict"),
	check("social_comments_body_check", sql`char_length(body) BETWEEN 1 AND 300`),
	check("social_comments_state_check", sql`state = ANY (ARRAY['visible'::text, 'held'::text, 'hidden'::text, 'removed'::text])`),
]);

export const social_kudos = pgTable("social_kudos", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	post_id: bigint({ mode: "number" }).notNull(),
	player_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("social_kudos_player_id_idx").using("btree", table.player_id.asc().nullsLast()),
	foreignKey({ columns: [table.post_id], foreignColumns: [social_posts.id], name: "social_kudos_post_id_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.player_id], foreignColumns: [players.id], name: "social_kudos_player_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.post_id, table.player_id], name: "social_kudos_pkey" }),
]);

// A club switches a person off in its own space.
export const social_club_bans = pgTable("social_club_bans", {
	club_id: integer().notNull(),
	player_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: integer(),
}, (table) => [
	index("social_club_bans_player_id_idx").using("btree", table.player_id.asc().nullsLast()),
	foreignKey({ columns: [table.club_id], foreignColumns: [tenants.id], name: "social_club_bans_club_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.player_id], foreignColumns: [players.id], name: "social_club_bans_player_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.created_by], foreignColumns: [players.id], name: "social_club_bans_created_by_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.club_id, table.player_id], name: "social_club_bans_pkey" }),
]);

// One person blocks another (shared with the Marketplace).
export const user_blocks = pgTable("user_blocks", {
	blocker_id: integer().notNull(),
	blocked_id: integer().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_blocks_blocked_id_idx").using("btree", table.blocked_id.asc().nullsLast()),
	foreignKey({ columns: [table.blocker_id], foreignColumns: [players.id], name: "user_blocks_blocker_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.blocked_id], foreignColumns: [players.id], name: "user_blocks_blocked_id_fkey" }).onDelete("restrict"),
	primaryKey({ columns: [table.blocker_id, table.blocked_id], name: "user_blocks_pkey" }),
	check("user_blocks_not_self_check", sql`blocker_id <> blocked_id`),
]);

// A moderator's decisions about a person. Insert only (the app's role can't
// update or delete); the latest row wins. player_id and created_by have no
// foreign key on purpose: the row outlives the account. The email and phone
// are kept only as keyed indexes.
export const player_suspensions = pgTable("player_suspensions", {
	// The database gives the id (GENERATED ALWAYS); the app's role can't write it or created_at.
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	player_id: integer(),
	action: text().default('suspend').notNull(),
	scope: text().notNull(),
	until: timestamp({ withTimezone: true, mode: 'string' }),
	reason_code: text().notNull(),
	email_index: text(),
	phone_index: text(),
	index_kid: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: integer(),
}, (table) => [
	index("player_suspensions_player_idx").using("btree", table.player_id.asc().nullsLast(), table.id.desc().nullsFirst()).where(sql`(player_id IS NOT NULL)`),
	index("player_suspensions_email_index_idx").using("btree", table.email_index.asc().nullsLast(), table.id.desc().nullsFirst()).where(sql`(email_index IS NOT NULL)`),
	index("player_suspensions_phone_index_idx").using("btree", table.phone_index.asc().nullsLast(), table.id.desc().nullsFirst()).where(sql`(phone_index IS NOT NULL)`),
	check("player_suspensions_action_check", sql`action = ANY (ARRAY['suspend'::text, 'unsuspend'::text])`),
	check("player_suspensions_scope_check", sql`scope = ANY (ARRAY['social'::text, 'market'::text, 'all'::text])`),
	check("player_suspensions_reason_code_check", sql`reason_code ~ '^[a-z][a-z0-9_]{0,39}$'::text`),
	check("player_suspensions_email_index_check", sql`email_index ~ '^[A-Za-z0-9_-]{43}$'::text`),
	check("player_suspensions_phone_index_check", sql`phone_index ~ '^[A-Za-z0-9_-]{43}$'::text`),
	check("player_suspensions_index_kid_check", sql`(index_kid IS NOT NULL) = (email_index IS NOT NULL OR phone_index IS NOT NULL)`),
	check("player_suspensions_names_someone_check", sql`player_id IS NOT NULL OR email_index IS NOT NULL OR phone_index IS NOT NULL`),
	check("player_suspensions_unsuspend_has_no_end_check", sql`action <> 'unsuspend'::text OR until IS NULL`),
	check("player_suspensions_unsuspend_names_account_check", sql`action <> 'unsuspend'::text OR (player_id IS NOT NULL AND email_index IS NULL AND phone_index IS NULL)`),
]);

// A report about a profile, a post or a comment (later a listing or a
// question). It names the target by type and id and holds no content; the
// reporter's words are kept only sealed. target_id and handled_by have no
// foreign key: the report outlives its target and its moderator's account.
export const content_reports = pgTable("content_reports", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	reporter_id: integer(),
	target_type: text().notNull(),
	target_id: bigint({ mode: "number" }).notNull(),
	club_id: integer(),
	reason: text().notNull(),
	severity: text().notNull(),
	queue: text().notNull(),
	details_sealed: text(),
	status: text().default('open').notNull(),
	due_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	alerted_at: timestamp({ withTimezone: true, mode: 'string' }),
	handled_by: integer(),
	handled_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("content_reports_one_open_idx").using("btree", table.reporter_id.asc().nullsLast(), table.target_type.asc().nullsLast(), table.target_id.asc().nullsLast()).where(sql`(status = 'open'::text)`),
	index("content_reports_status_due_idx").using("btree", table.status.asc().nullsLast(), table.due_at.asc().nullsLast()),
	index("content_reports_club_idx").using("btree", table.club_id.asc().nullsLast(), table.status.asc().nullsLast(), table.due_at.asc().nullsLast()).where(sql`(club_id IS NOT NULL)`),
	index("content_reports_target_idx").using("btree", table.target_type.asc().nullsLast(), table.target_id.asc().nullsLast()),
	foreignKey({ columns: [table.reporter_id], foreignColumns: [players.id], name: "content_reports_reporter_id_fkey" }).onDelete("restrict"),
	foreignKey({ columns: [table.club_id], foreignColumns: [tenants.id], name: "content_reports_club_id_fkey" }).onDelete("restrict"),
	check("content_reports_target_type_check", sql`target_type = ANY (ARRAY['profile'::text, 'post'::text, 'comment'::text, 'listing'::text, 'question'::text])`),
	check("content_reports_reason_check", sql`reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'sexual'::text, 'violence'::text, 'self_harm'::text, 'child_safety'::text, 'scam'::text, 'prohibited_item'::text, 'other'::text])`),
	check("content_reports_severity_check", sql`severity = ANY (ARRAY['normal'::text, 'serious'::text])`),
	check("content_reports_queue_check", sql`queue = ANY (ARRAY['club'::text, 'platform'::text])`),
	check("content_reports_status_check", sql`status = ANY (ARRAY['open'::text, 'actioned'::text, 'dismissed'::text])`),
	check("content_reports_serious_is_platform_check", sql`severity <> 'serious'::text OR queue = 'platform'::text`),
	check("content_reports_club_queue_has_club_check", sql`queue <> 'club'::text OR club_id IS NOT NULL`),
	check("content_reports_handled_check", sql`(status = 'open'::text) = (handled_at IS NULL)`),
	check("content_reports_details_sealed_check", sql`details_sealed ~ '^v1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'::text`),
]);

// Everything a moderator does, one row each. Insert only (the app's role
// can't update or delete). Ids and a short reason, never content. actor_id
// has no foreign key on purpose: the record outlives the account.
export const moderation_actions = pgTable("moderation_actions", {
	// The database gives the id (GENERATED ALWAYS); the app's role can't write it or created_at.
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	actor_id: integer(),
	target_type: text().notNull(),
	target_id: bigint({ mode: "number" }).notNull(),
	action: text().notNull(),
	reason: text(),
	report_id: bigint({ mode: "number" }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("moderation_actions_target_idx").using("btree", table.target_type.asc().nullsLast(), table.target_id.asc().nullsLast(), table.id.desc().nullsFirst()),
	index("moderation_actions_report_id_idx").using("btree", table.report_id.asc().nullsLast()).where(sql`(report_id IS NOT NULL)`),
	foreignKey({ columns: [table.report_id], foreignColumns: [content_reports.id], name: "moderation_actions_report_id_fkey" }).onDelete("restrict"),
	check("moderation_actions_target_type_check", sql`target_type = ANY (ARRAY['profile'::text, 'post'::text, 'comment'::text, 'listing'::text, 'question'::text])`),
	check("moderation_actions_action_check", sql`action = ANY (ARRAY['hide'::text, 'restore'::text, 'remove'::text, 'suspend'::text, 'unsuspend'::text, 'club_ban'::text, 'club_unban'::text, 'dismiss'::text])`),
	check("moderation_actions_reason_check", sql`char_length(reason) >= 1 AND char_length(reason) <= 200`),
]);

// For a child_safety report: a sealed copy of the content as it was when
// reported, and the author's account id (no foreign key: it stands when the
// account goes). Insert only.
export const moderation_evidence = pgTable("moderation_evidence", {
	report_id: bigint({ mode: "number" }).primaryKey().notNull(),
	sealed: text().notNull(),
	author_player_id: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.report_id], foreignColumns: [content_reports.id], name: "moderation_evidence_report_id_fkey" }).onDelete("restrict"),
	check("moderation_evidence_sealed_check", sql`sealed ~ '^v1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'::text`),
]);
