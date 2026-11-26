// A person's devices for push notifications, and which kinds they asked for
// (Phase 5 step 6; migration push_devices).
//
// - A device belongs to a person's ACCOUNT, not to a club. Every function
//   here takes the signed-in person's id and touches only their rows: nobody
//   reads, changes or removes another person's devices or choices.
// - The device's address (its FCM token) is stored only SEALED (lib/push/seal.ts)
//   plus a SHA-256 of it. With no PUSH_KEKS nothing is stored (fails closed).
// - One phone, one account: when a phone registers for a different person
//   (someone else signed in on it), its earlier row goes, so the first
//   person's notifications stop arriving on a phone they no longer hold.
// - An address is never logged and never returned to any caller except the
//   sender (addressesFor).
// - It is opt-in: a kind of notification is sent only when the person turned
//   it on.
import { createHash } from "node:crypto";
import { pushSeal, pushSealAvailable } from "./seal.ts";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Env = Record<string, string | undefined>;

/** The kinds of notification a person chooses between (build plan §4.2). */
export const PUSH_CATEGORIES = ["challenge", "result", "message", "reminder", "roster", "payment"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];
export const PUSH_PLATFORMS = ["android", "ios"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** A person keeps at most this many devices; the one unused longest goes first. */
export const MAX_DEVICES = 10;

export type PushPrefs = Record<PushCategory, boolean>;
export type RegisterResult = { ok: true } | { ok: false; code: "unavailable" | "invalid" };

const isCategory = (v: unknown): v is PushCategory => (PUSH_CATEGORIES as readonly unknown[]).includes(v);
const isPlatform = (v: unknown): v is PushPlatform => (PUSH_PLATFORMS as readonly unknown[]).includes(v);
/** What an FCM registration token looks like: one run of URL-safe characters and colons. */
const isAddress = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_:.\-]{32,4096}$/.test(v);
const hashOf = (address: string) => createHash("sha256").update(address).digest("hex");

/**
 * This device receives the person's notifications from now on. Registering
 * the same device again only notes that it is still in use.
 */
export async function registerDevice(db: Db, playerId: number, input: { token: unknown; platform: unknown }, env: Env = process.env): Promise<RegisterResult> {
  if (!pushSealAvailable(env)) return { ok: false, code: "unavailable" };
  if (!isAddress(input.token) || !isPlatform(input.platform)) return { ok: false, code: "invalid" };
  const hash = hashOf(input.token);
  const seen = await db.query(`UPDATE push_devices SET last_seen_at = NOW() WHERE token_hash = $1 AND player_id = $2 RETURNING id`, [hash, playerId]);
  if (seen.rows.length) return { ok: true };
  // The row's id is part of what the address is sealed to, so it is taken first.
  const id = Number((await db.query(`SELECT nextval('push_devices_id_seq') AS id`)).rows[0].id);
  const sealed = pushSeal(env).seal({ playerId, deviceId: id }, input.token);
  // The same phone under another account: that row becomes this person's
  // (new id, newly sealed), in one statement.
  await db.query(
    `INSERT INTO push_devices (id, player_id, platform, token_hash, sealed) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token_hash) DO UPDATE
       SET id = EXCLUDED.id, player_id = EXCLUDED.player_id, platform = EXCLUDED.platform, sealed = EXCLUDED.sealed, created_at = NOW(), last_seen_at = NOW()`,
    [id, playerId, input.platform, hash, sealed],
  );
  await db.query(
    `DELETE FROM push_devices WHERE player_id = $1 AND id NOT IN (SELECT id FROM push_devices WHERE player_id = $1 ORDER BY last_seen_at DESC, id DESC LIMIT $2)`,
    [playerId, MAX_DEVICES],
  );
  return { ok: true };
}

/** This device stops receiving (sign out, or notifications turned off on it). Only the person's own device. */
export async function removeDevice(db: Db, playerId: number, token: unknown): Promise<{ removed: boolean }> {
  if (!isAddress(token)) return { removed: false };
  const { rows } = await db.query(`DELETE FROM push_devices WHERE token_hash = $1 AND player_id = $2 RETURNING id`, [hashOf(token), playerId]);
  return { removed: rows.length > 0 };
}

/** All of the person's devices stop receiving (signed out everywhere, or the account deleted). */
export async function removeAllDevices(db: Db, playerId: number): Promise<number> {
  return (await db.query(`DELETE FROM push_devices WHERE player_id = $1 RETURNING id`, [playerId])).rows.length;
}

/** How many devices the person has registered (the addresses themselves are never shown). */
export async function countDevices(db: Db, playerId: number): Promise<number> {
  return Number((await db.query(`SELECT count(*)::int AS n FROM push_devices WHERE player_id = $1`, [playerId])).rows[0].n);
}

/** Which kinds the person asked for. Anything never chosen is off. */
export async function getPrefs(db: Db, playerId: number): Promise<PushPrefs> {
  const { rows } = await db.query(`SELECT category FROM push_prefs WHERE player_id = $1 AND enabled`, [playerId]);
  const on = new Set(rows.map((r) => String(r.category)));
  return Object.fromEntries(PUSH_CATEGORIES.map((c) => [c, on.has(c)])) as PushPrefs;
}

/** Turns kinds on or off; kinds not named stay as they are. Unknown kinds are refused. */
export async function setPrefs(db: Db, playerId: number, changes: Record<string, unknown>): Promise<{ ok: true; prefs: PushPrefs } | { ok: false; code: "invalid" }> {
  const entries = Object.entries(changes);
  if (!entries.length || entries.some(([k, v]) => !isCategory(k) || typeof v !== "boolean")) return { ok: false, code: "invalid" };
  for (const [category, enabled] of entries) {
    await db.query(
      `INSERT INTO push_prefs (player_id, category, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (player_id, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [playerId, category, enabled],
    );
  }
  return { ok: true, prefs: await getPrefs(db, playerId) };
}

/**
 * For the sender only: the addresses to send one kind of notification to for
 * one person. Empty when they didn't ask for that kind, when there is no key,
 * and for an account that was deleted. A row that can't be opened (sealed
 * with a key that is gone) is skipped, never guessed at.
 */
export async function addressesFor(db: Db, playerId: number, category: PushCategory, env: Env = process.env): Promise<string[]> {
  if (!isCategory(category) || !pushSealAvailable(env)) return [];
  const { rows } = await db.query(
    `SELECT d.id, d.sealed FROM push_devices d
       JOIN players p ON p.id = d.player_id AND p.deleted_at IS NULL
       JOIN push_prefs f ON f.player_id = d.player_id AND f.category = $2 AND f.enabled
      WHERE d.player_id = $1 ORDER BY d.id`,
    [playerId, category],
  );
  const seal = pushSeal(env);
  const out: string[] = [];
  for (const r of rows) {
    try {
      out.push(seal.open({ playerId, deviceId: Number(r.id) }, String(r.sealed)));
    } catch {
      // Unopenable: skipped.
    }
  }
  return out;
}
