// Sign-in (same codes and the same player_sessions as the web): the `auth.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const authEndpoints = defineEndpoints("auth", {
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
  "auth.handover": {
    method: "POST", path: "/auth/handover", auth: "public", scope: "account",
    body: S.handoverRequest, response: S.sessionCreatedResponse,
    rateLimit: { limit: 20, windowMs: 15 * MIN },
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
});
