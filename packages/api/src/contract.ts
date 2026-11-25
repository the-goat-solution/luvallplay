// The players' app API, endpoint by endpoint (build plan §4.1).
//
// Served by apps/web under /api/v1/app/... . The older /api/v1/* routes
// (personal access keys, shared with the MCP server) are a different surface
// and are not described here; their shapes don't change.
import type { z } from "zod";
import * as S from "./schemas.ts";

/** Bump only for a breaking change; the old version keeps being served beside the new one. */
export const API_VERSION = "v1";
/** Path of this API on its host. */
export const API_PREFIX = `/api/${API_VERSION}/app`;

export type Auth =
  /** Anyone. */
  | "public"
  /** A signed-in person: bearer token (the app) or the session cookie (the web). */
  | "session";

export type Endpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to API_PREFIX; `{name}` marks a path parameter. */
  path: string;
  auth: Auth;
  /** "club": the path names a club and the answer is only ever about that club. */
  scope: "account" | "club";
  /** The module that owns it: with that module off for the club, the endpoint answers 404. */
  module?: string;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /** Requests per window per caller (the signed-in person, else the address). */
  rateLimit: { limit: number; windowMs: number };
};

const MIN = 60_000;
const define = <T extends Record<string, Endpoint>>(endpoints: T): T => endpoints;

export const ENDPOINTS = define({
  // ── Sign-in (same codes and the same player_sessions as the web) ─────────
  "auth.emailStart": {
    method: "POST", path: "/auth/email/start", auth: "public", scope: "account",
    body: S.emailStartRequest, response: S.okResponse,
    rateLimit: { limit: 10, windowMs: 15 * MIN },
  },
  "auth.emailVerify": {
    method: "POST", path: "/auth/email/verify", auth: "public", scope: "account",
    body: S.emailVerifyRequest, response: S.sessionCreatedResponse,
    rateLimit: { limit: 30, windowMs: 15 * MIN },
  },
  "auth.smsStart": {
    method: "POST", path: "/auth/sms/start", auth: "public", scope: "account",
    body: S.smsStartRequest, response: S.smsStartResponse,
    rateLimit: { limit: 5, windowMs: 60 * MIN },
  },
  "auth.smsVerify": {
    method: "POST", path: "/auth/sms/verify", auth: "public", scope: "account",
    body: S.smsVerifyRequest, response: S.smsVerifyResponse,
    rateLimit: { limit: 20, windowMs: 15 * MIN },
  },
  "auth.session": {
    method: "GET", path: "/auth/session", auth: "session", scope: "account",
    response: S.sessionResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "auth.logout": {
    method: "POST", path: "/auth/logout", auth: "session", scope: "account",
    body: S.logoutRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  // ── Clubs ────────────────────────────────────────────────────────────────
  "clubs.list": {
    method: "GET", path: "/clubs", auth: "session", scope: "account",
    response: S.clubsResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "clubs.config": {
    method: "GET", path: "/clubs/{club}/config", auth: "public", scope: "club",
    params: S.clubParams, response: S.clubConfigResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  // ── Me (the home tab) ────────────────────────────────────────────────────
  "me.home": {
    method: "GET", path: "/clubs/{club}/me", auth: "session", scope: "club",
    params: S.clubParams, response: S.meResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  /** "Can't make it" on a membership day (and "I can come after all"). */
  "me.absence": {
    method: "POST", path: "/clubs/{club}/me/absence", auth: "session", scope: "club",
    params: S.clubParams, body: S.absenceRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  // ── Messages (the inbox) ─────────────────────────────────────────────────
  "messages.list": {
    method: "GET", path: "/clubs/{club}/messages", auth: "session", scope: "club",
    params: S.clubParams, response: S.threadsResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "messages.start": {
    method: "POST", path: "/clubs/{club}/messages", auth: "session", scope: "club",
    params: S.clubParams, body: S.newThreadRequest, response: S.newThreadResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "messages.thread": {
    method: "GET", path: "/clubs/{club}/messages/{id}", auth: "session", scope: "club",
    params: S.threadParams, response: S.threadResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "messages.reply": {
    method: "POST", path: "/clubs/{club}/messages/{id}", auth: "session", scope: "club",
    params: S.threadParams, body: S.replyRequest, response: S.replyResponse,
    rateLimit: { limit: 30, windowMs: 60 * MIN },
  },
  // ── The account (the same in every club) ────────────────────────────────
  "account.profile": {
    method: "GET", path: "/account/profile", auth: "session", scope: "account",
    response: S.profileResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "account.details": {
    method: "POST", path: "/account/details", auth: "session", scope: "account",
    body: S.detailsRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "account.language": {
    method: "POST", path: "/account/language", auth: "session", scope: "account",
    body: S.languageRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "account.privacy": {
    method: "POST", path: "/account/privacy", auth: "session", scope: "account",
    body: S.privacyRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "account.photo": {
    method: "POST", path: "/account/photo", auth: "session", scope: "account",
    body: S.photoRequest, response: S.photoResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "account.removePhoto": {
    method: "DELETE", path: "/account/photo", auth: "session", scope: "account",
    response: S.photoResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  // 403 forbidden: not an admin of this club. 403 step_up: signed in more than
  // 12 hours ago; confirm with a fresh code first (403, not 401, so the app
  // doesn't treat it as signed out).
  "account.adminHandoff": {
    method: "POST", path: "/account/admin-handoff", auth: "session", scope: "account",
    body: S.emptyRequest, response: S.adminHandoffResponse,
    rateLimit: { limit: 10, windowMs: MIN },
  },
  // 409 last_owner: the club's only owner hands over first. Signs the person
  // out everywhere; payment records stay with the club.
  "account.delete": {
    method: "POST", path: "/account/delete", auth: "session", scope: "account",
    body: S.deleteAccountRequest, response: S.okResponse,
    rateLimit: { limit: 5, windowMs: 60 * MIN },
  },
  // Connected apps (the website's Settings): personal access keys and
  // webhooks. A new key or webhook secret is shown once, in the answer.
  "integrations.list": {
    method: "GET", path: "/account/integrations", auth: "session", scope: "account",
    response: S.integrationsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  // 409 too_many: ten keys at most.
  "integrations.createToken": {
    method: "POST", path: "/account/integrations/tokens", auth: "session", scope: "account",
    body: S.newTokenRequest, response: S.newTokenResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "integrations.revokeToken": {
    method: "DELETE", path: "/account/integrations/tokens/{id}", auth: "session", scope: "account",
    params: S.integrationParams, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  // 400 invalid_url: only public https addresses. 409 too_many: five at most.
  "integrations.createWebhook": {
    method: "POST", path: "/account/integrations/webhooks", auth: "session", scope: "account",
    body: S.newWebhookRequest, response: S.newWebhookResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "integrations.deleteWebhook": {
    method: "DELETE", path: "/account/integrations/webhooks/{id}", auth: "session", scope: "account",
    params: S.integrationParams, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  // The Arena: the board snapshot (poll it while the tab is open) and one
  // action at a time, answered with the fresh snapshot. A refused action is
  // 409 with the Arena's own code (for example not_your_turn); fetch the
  // snapshot again after it.
  "arena.state": {
    method: "GET", path: "/clubs/{club}/arena", auth: "session", scope: "club", module: "arena",
    params: S.clubParams, response: S.arenaStateSchema,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "arena.action": {
    method: "POST", path: "/clubs/{club}/arena", auth: "session", scope: "club", module: "arena",
    params: S.clubParams, body: S.arenaActionRequest, response: S.arenaActionResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  // The Leaderboard tab: the points board for a source and period, and one
  // player's card (someone who hides from the board is 404, except to themselves).
  "leaderboard.board": {
    method: "GET", path: "/clubs/{club}/leaderboard", auth: "session", scope: "club", module: "arena",
    params: S.clubParams, query: S.boardQuery, response: S.boardResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "leaderboard.player": {
    method: "GET", path: "/clubs/{club}/players/{id}", auth: "session", scope: "club", module: "arena",
    params: S.playerParams, response: S.playerCardResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  // The Player tab: play days, streak, round robin, board places, history.
  "player.stats": {
    method: "GET", path: "/clubs/{club}/me/stats", auth: "session", scope: "club",
    params: S.clubParams, response: S.playerStatsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  // The club shop: products and your orders; an order paid by card (a
  // payment to confirm in the browser, held 15 minutes) or reserved for cash
  // at your next play day. Refusals are 409 with a code: sold_out,
  // not_found, invalid, inactive, cash_unavailable; confirm before the
  // payment succeeded is 409 not_paid.
  "shop.list": {
    method: "GET", path: "/clubs/{club}/shop", auth: "session", scope: "club", module: "shop",
    params: S.clubParams, response: S.shopResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "shop.order": {
    method: "POST", path: "/clubs/{club}/shop/orders", auth: "session", scope: "club", module: "shop",
    params: S.clubParams, body: S.shopOrderRequest, response: S.shopOrderResponse,
    rateLimit: { limit: 15, windowMs: 60 * MIN },
  },
  "shop.confirm": {
    method: "POST", path: "/clubs/{club}/shop/orders/{id}/confirm", auth: "session", scope: "club", module: "shop",
    params: S.orderParams, body: S.emptyRequest, response: S.orderResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "shop.cancel": {
    method: "POST", path: "/clubs/{club}/shop/orders/{id}/cancel", auth: "session", scope: "club", module: "shop",
    params: S.orderParams, body: S.emptyRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "account.export": {
    method: "GET", path: "/account/export", auth: "session", scope: "account",
    response: S.exportResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "account.dismissWelcome": {
    method: "POST", path: "/account/welcome-dismissed", auth: "session", scope: "account",
    body: S.emptyRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
});

export type EndpointId = keyof typeof ENDPOINTS;
type Def<K extends EndpointId> = (typeof ENDPOINTS)[K];
type Infer<T> = T extends z.ZodTypeAny ? z.input<T> : undefined;
type Out<T> = T extends z.ZodTypeAny ? z.output<T> : undefined;

export type ParamsOf<K extends EndpointId> = Def<K> extends { params: infer P } ? Infer<P> : undefined;
export type QueryOf<K extends EndpointId> = Def<K> extends { query: infer Q } ? Infer<Q> : undefined;
export type BodyOf<K extends EndpointId> = Def<K> extends { body: infer B } ? Infer<B> : undefined;
export type ResponseOf<K extends EndpointId> = Out<Def<K>["response"]>;

export { fillPath } from "./path.ts";
