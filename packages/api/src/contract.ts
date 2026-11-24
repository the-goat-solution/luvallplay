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
