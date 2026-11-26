// Connected apps: personal access keys and webhooks (the website's).
import { z } from "zod";

/** What an access key may do. Kept equal to apps/web/lib/webhooks.ts SCOPES (a test checks). */
export const API_SCOPES = ["read:stats", "read:attendance", "read:calendar", "write:activity"] as const;
/** What a webhook sends. Kept equal to apps/web/lib/webhooks.ts EVENTS (a test checks). */
export const WEBHOOK_EVENTS = ["attendance.recorded", "round_robin.result", "membership.changed", "photo.approved"] as const;
const apiScope = z.enum(API_SCOPES);
const webhookEvent = z.enum(WEBHOOK_EVENTS);
const isoTime = z.string();

export const apiTokenSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  scopes: z.array(apiScope),
  /** The first characters, to tell keys apart; the key itself is shown once. */
  prefix: z.string(),
  createdAt: isoTime,
  lastUsedAt: isoTime.nullable(),
});
export const webhookSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  events: z.array(webhookEvent),
  active: z.boolean(),
  createdAt: isoTime,
  lastStatus: z.string().nullable(),
});
export const integrationsResponse = z.object({
  tokens: z.array(apiTokenSchema),
  webhooks: z.array(webhookSchema),
});
export const newTokenRequest = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(apiScope).min(1),
});
export const newTokenResponse = z.object({ token: z.string(), record: apiTokenSchema });
export const newWebhookRequest = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(webhookEvent).min(1).optional(),
});
export const newWebhookResponse = z.object({ secret: z.string(), endpoint: webhookSchema });
export const integrationParams = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
