import { relations } from "drizzle-orm/relations";
import { players, admin_handoffs, api_tokens, sessions, bookings, cancellation_feedback, club_roles, finance_entries, bank_transactions, message_threads, messages, player_photos, player_sessions, platform_admins, player_events, session_alert_state, webhook_endpoints, webhook_deliveries, shop_orders, shop_products, shop_variants, shop_order_items, bank_matches, mini_game_draws, mini_game_scores } from "./schema";

export const admin_handoffsRelations = relations(admin_handoffs, ({one}) => ({
	player: one(players, {
		fields: [admin_handoffs.player_id],
		references: [players.id]
	}),
}));

export const playersRelations = relations(players, ({many}) => ({
	admin_handoffs: many(admin_handoffs),
	api_tokens: many(api_tokens),
	cancellation_feedbacks: many(cancellation_feedback),
	club_roles: many(club_roles),
	message_threads: many(message_threads),
	player_photos: many(player_photos),
	player_sessions: many(player_sessions),
	platform_admins: many(platform_admins),
	player_events: many(player_events),
	webhook_endpoints: many(webhook_endpoints),
	shop_orders: many(shop_orders),
}));

export const api_tokensRelations = relations(api_tokens, ({one}) => ({
	player: one(players, {
		fields: [api_tokens.player_id],
		references: [players.id]
	}),
}));

export const bookingsRelations = relations(bookings, ({one}) => ({
	session: one(sessions, {
		fields: [bookings.session_date],
		references: [sessions.date]
	}),
}));

export const sessionsRelations = relations(sessions, ({many}) => ({
	bookings: many(bookings),
	session_alert_states: many(session_alert_state),
}));

export const cancellation_feedbackRelations = relations(cancellation_feedback, ({one}) => ({
	player: one(players, {
		fields: [cancellation_feedback.player_id],
		references: [players.id]
	}),
}));

export const club_rolesRelations = relations(club_roles, ({one}) => ({
	player: one(players, {
		fields: [club_roles.player_id],
		references: [players.id]
	}),
}));

export const bank_transactionsRelations = relations(bank_transactions, ({one, many}) => ({
	finance_entry: one(finance_entries, {
		fields: [bank_transactions.entry_id],
		references: [finance_entries.id]
	}),
	bank_matches: many(bank_matches),
}));

export const finance_entriesRelations = relations(finance_entries, ({many}) => ({
	bank_transactions: many(bank_transactions),
	bank_matches: many(bank_matches),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	message_thread: one(message_threads, {
		fields: [messages.thread_id],
		references: [message_threads.id]
	}),
}));

export const message_threadsRelations = relations(message_threads, ({one, many}) => ({
	messages: many(messages),
	player: one(players, {
		fields: [message_threads.player_id],
		references: [players.id]
	}),
}));

export const player_photosRelations = relations(player_photos, ({one}) => ({
	player: one(players, {
		fields: [player_photos.player_id],
		references: [players.id]
	}),
}));

export const player_sessionsRelations = relations(player_sessions, ({one}) => ({
	player: one(players, {
		fields: [player_sessions.player_id],
		references: [players.id]
	}),
}));

export const platform_adminsRelations = relations(platform_admins, ({one}) => ({
	player: one(players, {
		fields: [platform_admins.player_id],
		references: [players.id]
	}),
}));

export const player_eventsRelations = relations(player_events, ({one}) => ({
	player: one(players, {
		fields: [player_events.player_id],
		references: [players.id]
	}),
}));

export const session_alert_stateRelations = relations(session_alert_state, ({one}) => ({
	session: one(sessions, {
		fields: [session_alert_state.session_date],
		references: [sessions.date]
	}),
}));

export const webhook_endpointsRelations = relations(webhook_endpoints, ({one, many}) => ({
	player: one(players, {
		fields: [webhook_endpoints.player_id],
		references: [players.id]
	}),
	webhook_deliveries: many(webhook_deliveries),
}));

export const webhook_deliveriesRelations = relations(webhook_deliveries, ({one}) => ({
	webhook_endpoint: one(webhook_endpoints, {
		fields: [webhook_deliveries.endpoint_id],
		references: [webhook_endpoints.id]
	}),
}));

export const shop_ordersRelations = relations(shop_orders, ({one, many}) => ({
	player: one(players, {
		fields: [shop_orders.player_id],
		references: [players.id]
	}),
	shop_order_items: many(shop_order_items),
}));

export const shop_variantsRelations = relations(shop_variants, ({one}) => ({
	shop_product: one(shop_products, {
		fields: [shop_variants.product_id],
		references: [shop_products.id]
	}),
}));

export const shop_productsRelations = relations(shop_products, ({many}) => ({
	shop_variants: many(shop_variants),
}));

export const shop_order_itemsRelations = relations(shop_order_items, ({one}) => ({
	shop_order: one(shop_orders, {
		fields: [shop_order_items.order_id],
		references: [shop_orders.id]
	}),
}));

export const bank_matchesRelations = relations(bank_matches, ({one}) => ({
	bank_transaction: one(bank_transactions, {
		fields: [bank_matches.bank_txn_id],
		references: [bank_transactions.id]
	}),
	finance_entry: one(finance_entries, {
		fields: [bank_matches.entry_id],
		references: [finance_entries.id]
	}),
}));

export const mini_game_scoresRelations = relations(mini_game_scores, ({one}) => ({
	mini_game_draw: one(mini_game_draws, {
		fields: [mini_game_scores.draw_id],
		references: [mini_game_draws.id]
	}),
}));

export const mini_game_drawsRelations = relations(mini_game_draws, ({many}) => ({
	mini_game_scores: many(mini_game_scores),
}));