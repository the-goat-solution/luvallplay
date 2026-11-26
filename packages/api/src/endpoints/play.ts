// The `play.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const playEndpoints = defineEndpoints("play", {
  "play.book": {
    method: "POST", path: "/clubs/{club}/me/book", auth: "session", scope: "club",
    params: S.clubParams, body: S.bookRequest, response: S.paymentStartResponse,
    rateLimit: { limit: 10, windowMs: MIN },
  },
});
