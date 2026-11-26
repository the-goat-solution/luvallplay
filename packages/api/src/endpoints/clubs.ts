// Clubs: the `clubs.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const clubsEndpoints = defineEndpoints("clubs", {
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
