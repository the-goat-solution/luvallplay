// The `arena.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const arenaEndpoints = defineEndpoints("arena", {
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
  // A game's tracked stats (the website's GET /api/arena/match-stats: any signed-in player, Arena on).
  "arena.matchStats": {
    method: "GET", path: "/clubs/{club}/arena/challenges/{id}/stats", auth: "session", scope: "club", module: "arena",
    params: S.visionChallengeParams, response: S.visionChallengeResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
});
