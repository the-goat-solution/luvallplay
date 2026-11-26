// The `leaderboard.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const leaderboardEndpoints = defineEndpoints("leaderboard", {
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
});
