// Me (the home tab): the `me.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const meEndpoints = defineEndpoints("me", {
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
});
