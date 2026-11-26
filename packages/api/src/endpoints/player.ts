// The `player.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const playerEndpoints = defineEndpoints("player", {
  // The Player tab: play days, streak, round robin, board places, history.
  "player.stats": {
    method: "GET", path: "/clubs/{club}/me/stats", auth: "session", scope: "club",
    params: S.clubParams, response: S.playerStatsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
});
