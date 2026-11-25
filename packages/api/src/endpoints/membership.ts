// The `membership.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const membershipEndpoints = defineEndpoints("membership", {
  // Membership self-service (module memberships), as the website's Me:
  // the membership with what can be done with it, billing from Stripe,
  // one change at a time, updating the card in Stripe's portal, joining,
  // and booking a casual spot (a payment). Refusals are 409 with a code
  // (day_paused, sessions_full, already_member, already_renewed,
  // not_one_time, card_not_saved, cancelling, not_recurring, not_active,
  // full, locked); 404 no_membership.
  "membership.state": {
    method: "GET", path: "/clubs/{club}/membership", auth: "session", scope: "club", module: "memberships",
    params: S.clubParams, response: S.membershipStateResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "membership.billing": {
    method: "GET", path: "/clubs/{club}/membership/billing", auth: "session", scope: "club", module: "memberships",
    params: S.clubParams, response: S.billingResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "membership.action": {
    method: "POST", path: "/clubs/{club}/membership", auth: "session", scope: "club", module: "memberships",
    params: S.clubParams, body: S.membershipActionRequest, response: S.membershipActionResponse,
    rateLimit: { limit: 20, windowMs: 60 * MIN },
  },
  "membership.portal": {
    method: "POST", path: "/clubs/{club}/membership/portal", auth: "session", scope: "club", module: "memberships",
    params: S.clubParams, body: S.emptyRequest, response: S.portalResponse,
    rateLimit: { limit: 10, windowMs: MIN },
  },
  "membership.join": {
    method: "POST", path: "/clubs/{club}/membership/join", auth: "session", scope: "club", module: "memberships",
    params: S.clubParams, body: S.joinRequest, response: S.paymentStartResponse,
    rateLimit: { limit: 10, windowMs: MIN },
  },
});
