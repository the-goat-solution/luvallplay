// The `vision.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const visionEndpoints = defineEndpoints("vision", {
  // Vision (module vision): the trial or a pass, a challenge's teams and
  // saved stats, the players to put on court, and the labelling set.
  "vision.status": {
    method: "GET", path: "/clubs/{club}/vision", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, query: S.visionStatusQuery, response: S.visionStatusResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "vision.challenge": {
    method: "GET", path: "/clubs/{club}/vision/challenges/{id}", auth: "session", scope: "club", module: "vision",
    params: S.visionChallengeParams, response: S.visionChallengeResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "vision.players": {
    method: "GET", path: "/clubs/{club}/vision/players", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, response: S.visionPlayersResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "vision.labels": {
    method: "POST", path: "/clubs/{club}/vision/labels", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionLabelsRequest, response: S.visionLabelsResponse,
    rateLimit: { limit: 20, windowMs: 60 * MIN },
  },
  // The tracker itself (the same calls as the website's tracker).
  "vision.pass": {
    method: "GET", path: "/clubs/{club}/vision/pass", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, query: S.visionPassQuery, response: S.visionPassResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "vision.buy": {
    method: "POST", path: "/clubs/{club}/vision/pass", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionBuyRequest, response: S.visionBuyResponse,
    rateLimit: { limit: 10, windowMs: MIN },
  },
  "vision.use": {
    method: "PATCH", path: "/clubs/{club}/vision/pass", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionUseRequest, response: S.visionUseResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "vision.save": {
    method: "POST", path: "/clubs/{club}/vision/stats", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionStatsRequest, response: S.visionStatsResponse,
    rateLimit: { limit: 20, windowMs: MIN },
  },
  "vision.beat": {
    method: "PUT", path: "/clubs/{club}/vision/stats", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionBeatRequest, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  "vision.model": {
    method: "GET", path: "/clubs/{club}/vision/model", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, response: S.visionModelResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "vision.train": {
    method: "POST", path: "/clubs/{club}/vision/model", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionTrainRequest, response: S.visionTrainResponse,
    rateLimit: { limit: 6, windowMs: 60 * MIN },
  },
  "vision.share": {
    method: "POST", path: "/clubs/{club}/vision/share", auth: "session", scope: "club", module: "vision",
    params: S.clubParams, body: S.visionShareRequest, response: S.visionShareResponse,
    rateLimit: { limit: 12, windowMs: 24 * 60 * MIN },
  },
});
