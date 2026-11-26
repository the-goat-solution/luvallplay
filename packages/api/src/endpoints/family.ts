// The `family.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const familyEndpoints = defineEndpoints("family", {
  // A guardian's family (module juniors): the children they manage in this
  // club. Only ever the caller's own children. With Juniors off the whole
  // group answers 404 module_off. Refusals: 400 name_required,
  // name_invalid, birth_year, consent_required; 409 duplicate, too_many;
  // 404 not_found (not this guardian's child, or not in this club).
  "family.list": {
    method: "GET", path: "/clubs/{club}/family", auth: "session", scope: "club", module: "juniors",
    params: S.clubParams, response: S.familyResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "family.add": {
    method: "POST", path: "/clubs/{club}/family", auth: "session", scope: "club", module: "juniors",
    params: S.clubParams, body: S.familyAddRequest, response: S.familyChildResponse,
    rateLimit: { limit: 10, windowMs: 10 * MIN },
  },
  "family.update": {
    method: "PATCH", path: "/clubs/{club}/family/{id}", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyUpdateRequest, response: S.familyChildResponse,
    rateLimit: { limit: 20, windowMs: 10 * MIN },
  },
  "family.consent": {
    method: "PUT", path: "/clubs/{club}/family/{id}/consent", auth: "session", scope: "club", module: "juniors",
    params: S.familyChildParams, body: S.familyConsentRequest, response: S.familyChildResponse,
    rateLimit: { limit: 30, windowMs: 10 * MIN },
  },
});
