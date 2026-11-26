// Messages (the inbox): the `messages.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const messagesEndpoints = defineEndpoints("messages", {
  "messages.list": {
    method: "GET", path: "/clubs/{club}/messages", auth: "session", scope: "club",
    params: S.clubParams, response: S.threadsResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "messages.start": {
    method: "POST", path: "/clubs/{club}/messages", auth: "session", scope: "club",
    params: S.clubParams, body: S.newThreadRequest, response: S.newThreadResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "messages.thread": {
    method: "GET", path: "/clubs/{club}/messages/{id}", auth: "session", scope: "club",
    params: S.threadParams, response: S.threadResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "messages.reply": {
    method: "POST", path: "/clubs/{club}/messages/{id}", auth: "session", scope: "club",
    params: S.threadParams, body: S.replyRequest, response: S.replyResponse,
    rateLimit: { limit: 30, windowMs: 60 * MIN },
  },
});
