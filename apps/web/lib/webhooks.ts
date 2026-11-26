import crypto from "crypto";
import { sql } from "./database";
import { isAllowedWebhookUrl, postToPublicHost } from "./webhook-target";

// Personal access tokens and outgoing webhooks, so habit trackers (q.buzz
// once it has an API) and AI assistants (MCP) can read a player's activity
// and send check-ins in. Only hashed tokens are stored.

export const SCOPES = ["read:stats", "read:attendance", "read:calendar", "write:activity"] as const;
export type Scope = (typeof SCOPES)[number];
export const EVENTS = ["attendance.recorded", "round_robin.result", "membership.changed", "photo.approved"] as const;
export type WebhookEvent = (typeof EVENTS)[number];

const MAX_ATTEMPTS = 6;

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type ApiToken = { id: number; name: string; scopes: Scope[]; prefix: string; createdAt: string; lastUsedAt: string | null };

export async function createApiToken(playerId: number, name: string, scopes: Scope[]): Promise<{ token: string; record: ApiToken }> {
  const token = `tw_${crypto.randomBytes(24).toString("base64url")}`;
  const clean = scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  const { rows } = await sql.query(
    `INSERT INTO api_tokens (player_id, name, scopes, token_hash, prefix) VALUES ($1, $2, $3::text[], $4, $5)
     RETURNING id, name, scopes, prefix, created_at, last_used_at;`,
    [playerId, name.trim().slice(0, 60) || "My app", clean, sha256(token), token.slice(0, 9)],
  );
  return { token, record: mapToken(rows[0]) };
}

function mapToken(r: Record<string, unknown>): ApiToken {
  return {
    id: r.id as number,
    name: r.name as string,
    scopes: r.scopes as Scope[],
    prefix: r.prefix as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as Date).toISOString() : null,
  };
}

export async function listApiTokens(playerId: number): Promise<ApiToken[]> {
  if (!process.env.POSTGRES_URL) return [];
  const { rows } = await sql`
    SELECT id, name, scopes, prefix, created_at, last_used_at FROM api_tokens
    WHERE player_id = ${playerId} AND revoked_at IS NULL ORDER BY created_at DESC;
  `;
  return rows.map(mapToken);
}

export async function revokeApiToken(playerId: number, id: number): Promise<void> {
  await sql`UPDATE api_tokens SET revoked_at = NOW() WHERE id = ${id} AND player_id = ${playerId};`;
}

/** The player and scopes behind a bearer token, or null. */
export async function authenticateToken(raw: string | null | undefined): Promise<{ playerId: number; email: string; scopes: Scope[] } | null> {
  if (!raw || !raw.startsWith("tw_") || raw.length > 80) return null;
  const { rows } = await sql`
    UPDATE api_tokens t SET last_used_at = NOW()
    FROM players p
    WHERE t.token_hash = ${sha256(raw)} AND t.revoked_at IS NULL AND p.id = t.player_id AND p.deleted_at IS NULL
    RETURNING t.player_id, t.scopes, p.email;
  `;
  const r = rows[0];
  return r ? { playerId: r.player_id as number, email: r.email as string, scopes: r.scopes as Scope[] } : null;
}

export function bearerFrom(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookEndpoint = { id: number; url: string; events: WebhookEvent[]; active: boolean; createdAt: string; lastStatus: string | null };

// The address rules, and the guarded connection used at delivery: lib/webhook-target.ts.
export { isAllowedWebhookUrl };

export async function createWebhookEndpoint(playerId: number, url: string, events: WebhookEvent[]): Promise<{ secret: string; endpoint: WebhookEndpoint }> {
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const clean = events.filter((e): e is WebhookEvent => (EVENTS as readonly string[]).includes(e));
  const { rows } = await sql.query(
    `INSERT INTO webhook_endpoints (player_id, url, secret, events) VALUES ($1, $2, $3, $4::text[])
     RETURNING id, url, events, active, created_at, last_status;`,
    [playerId, url, secret, clean],
  );
  return { secret, endpoint: mapEndpoint(rows[0]) };
}

function mapEndpoint(r: Record<string, unknown>): WebhookEndpoint {
  return {
    id: r.id as number,
    url: r.url as string,
    events: r.events as WebhookEvent[],
    active: r.active as boolean,
    createdAt: new Date(r.created_at as Date).toISOString(),
    lastStatus: (r.last_status as string | null) ?? null,
  };
}

export async function listWebhookEndpoints(playerId: number): Promise<WebhookEndpoint[]> {
  if (!process.env.POSTGRES_URL) return [];
  const { rows } = await sql`
    SELECT id, url, events, active, created_at, last_status FROM webhook_endpoints
    WHERE player_id = ${playerId} ORDER BY created_at DESC;
  `;
  return rows.map(mapEndpoint);
}

export async function deleteWebhookEndpoint(playerId: number, id: number): Promise<void> {
  await sql`DELETE FROM webhook_endpoints WHERE id = ${id} AND player_id = ${playerId};`;
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` — like Stripe's scheme. */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

async function deliver(deliveryId: number): Promise<boolean> {
  const { rows } = await sql`
    SELECT d.id, d.event, d.payload, d.attempts, e.url, e.secret, e.id AS endpoint_id
    FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.id = ${deliveryId} AND e.active;
  `;
  const d = rows[0];
  if (!d) return false;
  const body = JSON.stringify(d.payload);
  // Only to a public address, checked at the moment of connecting; what is
  // kept about a failure is a fixed word, never the network's own message.
  const outcome = await postToPublicHost(
    d.url as string,
    {
      "Content-Type": "application/json",
      "User-Agent": "ThreeWolves-Webhooks/1",
      "X-ThreeWolves-Event": d.event as string,
      "X-ThreeWolves-Delivery": String(d.id),
      "X-ThreeWolves-Signature": signPayload(d.secret as string, body),
    },
    body,
  );
  const ok = outcome.ok;
  const error = outcome.ok ? null : outcome.error;
  const attempts = (d.attempts as number) + 1;
  if (ok) {
    await sql`UPDATE webhook_deliveries SET status = 'delivered', attempts = ${attempts}, delivered_at = NOW(), last_error = NULL WHERE id = ${deliveryId};`;
  } else {
    // Back off: 1, 4, 16, 64… minutes; the daily cron picks up the rest.
    const failed = attempts >= MAX_ATTEMPTS;
    await sql.query(
      `UPDATE webhook_deliveries SET status = $2, attempts = $3, last_error = $4,
         next_attempt_at = NOW() + (power(4, $3 - 1) * INTERVAL '1 minute') WHERE id = $1;`,
      [deliveryId, failed ? "failed" : "pending", attempts, error],
    );
  }
  await sql`UPDATE webhook_endpoints SET last_status = ${ok ? "ok" : error} WHERE id = ${d.endpoint_id};`;
  return ok;
}

/**
 * Queues an event for every endpoint of the given players that listens for
 * it, and tries to deliver straight away. Best effort: never throws.
 */
export async function emitToPlayers(emails: string[], event: WebhookEvent, dataFor: (email: string) => Record<string, unknown>): Promise<void> {
  if (emails.length === 0 || !process.env.POSTGRES_URL) return;
  try {
    const { rows } = await sql.query(
      `SELECT e.id, p.email FROM webhook_endpoints e JOIN players p ON p.id = e.player_id
       WHERE e.active AND $2 = ANY(e.events) AND p.email = ANY($1::text[]) AND p.deleted_at IS NULL;`,
      [emails.map((e) => e.trim().toLowerCase()), event],
    );
    for (const r of rows) {
      const payload = { event, created: new Date().toISOString(), data: dataFor(r.email as string) };
      const { rows: ins } = await sql`
        INSERT INTO webhook_deliveries (endpoint_id, event, payload) VALUES (${r.id}, ${event}, ${JSON.stringify(payload)}::jsonb)
        RETURNING id;
      `;
      await deliver(ins[0].id as number);
    }
  } catch (err) {
    console.error("[webhooks] emit failed:", event, err);
  }
}

/** Retries due deliveries (daily cron, and opportunistically on new events). */
export async function retryWebhookDeliveries(limit = 50): Promise<{ retried: number; delivered: number }> {
  if (!process.env.POSTGRES_URL) return { retried: 0, delivered: 0 };
  const { rows } = await sql`
    SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at LIMIT ${limit};
  `;
  let delivered = 0;
  for (const r of rows) if (await deliver(r.id as number)) delivered++;
  return { retried: rows.length, delivered };
}
