import crypto from "crypto";
import { sql } from "@vercel/postgres";
import {
  ActionError,
  applyAction,
  clampCourts,
  emptyState,
  resizeCourts,
  type Action,
  type CasualPlayState,
  type Player,
  type Tier,
} from "./casual-play";
import { getCourtsForDate, getRosterForDate, setCourtsForDate } from "./db";
import { notifyWaitlistIfSpotOpened } from "./waitlist-notify";
import { maxPlayersForCourts } from "./constants";
import { demoRoster, demoStore, isCasualPlayDemo } from "./casual-play-demo";

// Same memoised, idempotent DDL approach as ensureTables() in lib/db.ts.
let ensurePromise: Promise<void> | null = null;

export function ensureCasualPlayTables(): Promise<void> {
  if (isCasualPlayDemo()) return Promise.resolve();
  if (!ensurePromise) {
    ensurePromise = ensureImpl().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureImpl() {
  await sql`
    CREATE TABLE IF NOT EXISTS casual_play_sessions (
      date DATE PRIMARY KEY,
      state JSONB NOT NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // Tier is remembered per person (by email), so next week's board starts
  // with everyone already in the right tier. nickname is no longer used: the
  // board shows names from the play day roster.
  await sql`
    CREATE TABLE IF NOT EXISTS casual_play_profiles (
      email TEXT PRIMARY KEY,
      tier SMALLINT,
      nickname TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

/**
 * Stable, opaque player id derived from the email, so the board can be
 * shown publicly without exposing anyone's address.
 */
function playerIdForEmail(email: string): string {
  return `p_${crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

type RosterPlayer = { id: string; email: string; firstName: string; fullName: string };

/** Who is actually playing on the date: a fill-in takes their player's place. */
async function rosterPlayers(date: string): Promise<RosterPlayer[]> {
  const roster = isCasualPlayDemo() ? demoRoster() : await getRosterForDate(date);
  const seen = new Set<string>();
  const out: RosterPlayer[] = [];
  for (const entry of roster) {
    const person = entry.fillIn ?? entry;
    const email = person.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const fullName = person.name.trim() || email.split("@")[0];
    // Prefer the first name as entered: "Gia Minh" is one given name.
    const firstName = person.firstName || fullName.split(/\s+/)[0];
    out.push({ id: playerIdForEmail(email), email, firstName, fullName });
  }
  return out;
}

/** First names, with a last initial added only where two people share one. */
function displayNames(players: RosterPlayer[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p.firstName.toLowerCase(), (counts.get(p.firstName.toLowerCase()) ?? 0) + 1);
  return new Map(
    players.map((p) => {
      if ((counts.get(p.firstName.toLowerCase()) ?? 0) < 2) return [p.id, p.firstName];
      const parts = p.fullName.split(/\s+/);
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      return [p.id, last ? `${p.firstName} ${last[0].toUpperCase()}.` : p.firstName];
    }),
  );
}

type Profile = { tier: Tier | null };

async function profilesFor(emails: string[]): Promise<Map<string, Profile>> {
  if (emails.length === 0) return new Map();
  if (isCasualPlayDemo()) {
    return new Map(emails.flatMap((e) => (demoStore.profiles.has(e) ? [[e, demoStore.profiles.get(e)!]] : [])));
  }
  const { rows } = await sql.query(
    `SELECT email, tier FROM casual_play_profiles WHERE email = ANY($1::text[]);`,
    [emails],
  );
  return new Map(
    rows.map((r) => [r.email as string, { tier: r.tier === 1 || r.tier === 2 ? (r.tier as Tier) : null }]),
  );
}

/**
 * Brings the stored board in line with the play day's roster: new sign-ups
 * appear (in their remembered tier), cancellations drop off unless they're
 * mid-game, and names follow the roster. Guests are left alone.
 */
function mergeRoster(
  state: CasualPlayState,
  roster: RosterPlayer[],
  profiles: Map<string, Profile>,
  now: number,
): CasualPlayState {
  const names = displayNames(roster);
  const rosterIds = new Set(roster.map((p) => p.id));
  const busy = new Set(state.onCourt.flatMap((g) => (g ? [...g.teamA, ...g.teamB] : [])));
  const byId = new Map(state.players.map((p) => [p.id, p]));

  const players: Player[] = state.players.filter((p) => p.guest || rosterIds.has(p.id) || busy.has(p.id));
  for (const r of roster) {
    const profile = profiles.get(r.email);
    const name = names.get(r.id) || r.firstName;
    const existing = byId.get(r.id);
    if (existing) {
      existing.name = name;
      continue;
    }
    players.push({
      id: r.id,
      name,
      tier: profile?.tier ?? null,
      paused: false,
      guest: false,
      games: 0,
      readyAt: now,
    });
  }
  // Someone previewed as up next who has since dropped off the roster.
  const kept = new Set(players.map((p) => p.id));
  const next = state.next && [...state.next.teamA, ...state.next.teamB].every((id) => kept.has(id)) ? state.next : null;
  return { ...state, players, next };
}

type Loaded = {
  state: CasualPlayState;
  version: number | null;
  roster: RosterPlayer[];
};

async function readStored(date: string): Promise<{ state: CasualPlayState; version: number } | undefined> {
  if (isCasualPlayDemo()) {
    const row = demoStore.boards.get(date);
    return row && { state: structuredClone(row.state) as CasualPlayState, version: row.version };
  }
  const { rows } = await sql<{ state: CasualPlayState; version: number }>`
    SELECT state, version FROM casual_play_sessions WHERE date = ${date};
  `;
  return rows[0];
}

/** Courts booked for the date, as set on the play day roster. */
async function rosterCourts(date: string): Promise<number> {
  if (isCasualPlayDemo()) return demoStore.courts.get(date) ?? 2;
  return getCourtsForDate(date);
}

async function load(date: string, now: number): Promise<Loaded> {
  const [stored, roster, courts] = await Promise.all([readStored(date), rosterPlayers(date), rosterCourts(date)]);
  const profiles = await profilesFor(roster.map((r) => r.email));
  // The roster owns the court count: a change there shows up on the board
  // the next time anyone loads it.
  let base = stored ? stored.state : emptyState(date, courts);
  if (base.courts !== courts || base.courtNumbers?.length !== courts) base = resizeCourts(base, courts);
  return {
    state: mergeRoster(structuredClone(base), roster, profiles, now),
    version: stored ? stored.version : null,
    roster,
  };
}

export async function getCasualPlayState(date: string): Promise<CasualPlayState> {
  return (await load(date, Date.now())).state;
}

export class ConflictError extends Error {}

/** Saves only if nobody else saved first; false means try again. */
async function save(date: string, state: CasualPlayState, version: number | null): Promise<boolean> {
  if (isCasualPlayDemo()) {
    if ((demoStore.boards.get(date)?.version ?? null) !== version) return false;
    demoStore.boards.set(date, { state: structuredClone(state), version: (version ?? 0) + 1 });
    return true;
  }
  const json = JSON.stringify(state);
  if (version === null) {
    const { rows } = await sql`
      INSERT INTO casual_play_sessions (date, state) VALUES (${date}, ${json}::jsonb)
      ON CONFLICT (date) DO NOTHING
      RETURNING date;
    `;
    return rows.length > 0;
  }
  const { rows } = await sql`
    UPDATE casual_play_sessions
    SET state = ${json}::jsonb, version = version + 1, updated_at = NOW()
    WHERE date = ${date} AND version = ${version}
    RETURNING date;
  `;
  return rows.length > 0;
}

async function rememberProfile(email: string, change: Profile): Promise<void> {
  if (isCasualPlayDemo()) {
    demoStore.profiles.set(email, { ...demoStore.profiles.get(email), ...change });
    return;
  }
  await sql`
    INSERT INTO casual_play_profiles (email, tier) VALUES (${email}, ${change.tier})
    ON CONFLICT (email) DO UPDATE SET tier = EXCLUDED.tier, updated_at = NOW();
  `;
}

/**
 * Changing the courts on the board changes them on the play day roster too,
 * with the same rules as the admin page: it can't drop below the players
 * already signed up, and extra room lets the waitlist know.
 */
async function setRosterCourts(date: string, courts: number): Promise<void> {
  if (isCasualPlayDemo()) {
    demoStore.courts.set(date, courts);
    return;
  }
  const before = await getCourtsForDate(date);
  if (before === courts) return;
  const result = await setCourtsForDate(date, courts);
  if (!result.ok) throw new ActionError(result.reason);
  if (maxPlayersForCourts(courts) > maxPlayersForCourts(before)) await notifyWaitlistIfSpotOpened(date);
}

/**
 * Runs an organiser action against the stored board. Two organisers tapping
 * at once can't overwrite each other: a save only lands on the version it
 * was computed from, and a clash is retried on the fresh state.
 */
export async function runCasualPlayAction(date: string, action: Action): Promise<CasualPlayState> {
  if (action.type === "setCourts") await setRosterCourts(date, clampCourts(action.courts));
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const { state, version, roster } = await load(date, now);
    const next = applyAction(state, action, now);
    if (!(await save(date, next, version))) continue;

    const email = roster.find((r) => "playerId" in action && r.id === action.playerId)?.email;
    if (email && action.type === "setTier") await rememberProfile(email, { tier: action.tier });
    return next;
  }
  throw new ConflictError("The board is busy. Please try again.");
}
