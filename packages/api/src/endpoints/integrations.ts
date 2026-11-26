// The `integrations.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const integrationsEndpoints = defineEndpoints("integrations", {
  // Connected apps (the website's Settings): personal access keys and
  // webhooks. A new key or webhook secret is shown once, in the answer.
  "integrations.list": {
    method: "GET", path: "/account/integrations", auth: "session", scope: "account",
    response: S.integrationsResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  // 409 too_many: ten keys at most.
  "integrations.createToken": {
    method: "POST", path: "/account/integrations/tokens", auth: "session", scope: "account",
    body: S.newTokenRequest, response: S.newTokenResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "integrations.revokeToken": {
    method: "DELETE", path: "/account/integrations/tokens/{id}", auth: "session", scope: "account",
    params: S.integrationParams, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
  // 400 invalid_url: only public https addresses. 409 too_many: five at most.
  "integrations.createWebhook": {
    method: "POST", path: "/account/integrations/webhooks", auth: "session", scope: "account",
    body: S.newWebhookRequest, response: S.newWebhookResponse,
    rateLimit: { limit: 10, windowMs: 60 * MIN },
  },
  "integrations.deleteWebhook": {
    method: "DELETE", path: "/account/integrations/webhooks/{id}", auth: "session", scope: "account",
    params: S.integrationParams, response: S.okResponse,
    rateLimit: { limit: 30, windowMs: MIN },
  },
});
