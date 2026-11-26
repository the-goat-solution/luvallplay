// The account (the same in every club): the `account.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const accountEndpoints = defineEndpoints("account", {
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
