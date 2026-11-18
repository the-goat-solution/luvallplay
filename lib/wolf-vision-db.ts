import { sql } from "@vercel/postgres";
import { z } from "zod";
import { ensurePlayerTables, getPlayerSetting, setPlayerSetting } from "./player-db";
import { onceThisDeploy } from "./schema-gate";
import { getStripe } from "./stripe";
import { sendPlayerNoticeEmail } from "./player-email";
import { loadWorld } from "./arena-db";
import { TECHNICAL_FAILURES, finishedSessionFailure, refundDecision, type TechnicalFailure } from "./wolf-vision-rules";
export { AUTO_REFUNDS_PER_30_DAYS, TECHNICAL_FAILURES, finishedSessionFailure, refundDecision, type TechnicalFailure } from "./wolf-vision-rules";

// Wolf Vision sessions: who may use it outside the Arena, the stats each
// player gets from a tracked game, and (switched off until the club turns it
// on) the pay-per-use wall with automatic refunds for technical failures.
//
// Access
//   • Arena challenges: any signed-in player, as before (opt-in per game).
//   • Profile ("my own game", outside the Arena): players on the access list
//     (admin → Players → Wolf Vision access), or everyone once
//     WOLF_VISION_OPEN=1.
//
// Paywall (WOLF_VISION_PAYWALL=1; off by default)
//   • Upload analysis WV_PRICE_UPLOAD_CENTS (default 250 = NZ$2.50),
//     live session WV_PRICE_LIVE_CENTS (default 500 = NZ$5). Players on the
//     access list are never charged.
//   • A paid session that fails for a technical reason (camera or AI model
//     would not start, the engine crashed, tracking or capture quality
//     collapsed, the phone stopped reporting mid-game) is refunded
//     automatically, at most AUTO_REFUNDS_PER_30_DAYS times per player; past
//     that it is flagged for an admin.
//
// Preview deployments share the production database: tables get a "pv_" prefix there.

const PREFIX = process.env.ARENA_TABLE_PREFIX ?? (process.env.VERCEL_ENV === "preview" ? "pv_" : "");
const T = {
  sessions: `${PREFIX}wolf_vision_sessions`,
  stats: `${PREFIX}wolf_vision_player_stats`,
};
const ACCESS_KEY = `${PREFIX}wolf_vision_access`;

/** A paid live session with no heartbeat for this long, never finished, counts as a dropped session. */
const DROPPED_AFTER_MIN = 20;

export type WvMode = "live" | "upload";
export type WvKind = "arena" | "personal";

export function wolfVisionPrices(): Record<WvMode, number> {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
  return { upload: n(process.env.WV_PRICE_UPLOAD_CENTS, 250), live: n(process.env.WV_PRICE_LIVE_CENTS, 500) };
}

export function paywallOn(): boolean {
  return process.env.WOLF_VISION_PAYWALL === "1";
}

let ensurePromise: Promise<void> | null = null;
export function ensureWolfVisionTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy(`wolf-vision${PREFIX}`, async () => {
      await ensurePlayerTables();
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.sessions} (
          id SERIAL PRIMARY KEY,
          owner_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          mode TEXT NOT NULL,
          challenge_id INT,
          status TEXT NOT NULL,
          price_cents INT NOT NULL DEFAULT 0,
          payment_intent TEXT,
          refund_id TEXT,
          refund_reason TEXT,
          failure TEXT,
          quality REAL,
          summary JSONB,
          started_at TIMESTAMPTZ,
          last_beat_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`);
      await sql.query(`CREATE INDEX IF NOT EXISTS ${T.sessions}_owner_idx ON ${T.sessions} (owner_id, created_at DESC);`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS ${T.stats} (
          session_id INT NOT NULL REFERENCES ${T.sessions}(id) ON DELETE CASCADE,
          player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          team INT NOT NULL,
          slot INT NOT NULL,
          stats JSONB NOT NULL,
          notified_at TIMESTAMPTZ,
          seen_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_id, player_id)
        );`);
      await sql.query(`CREATE INDEX IF NOT EXISTS ${T.stats}_player_idx ON ${T.stats} (player_id, created_at DESC);`);
    }).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

// ── Access ────────────────────────────────────────────────────────────────

export async function accessList(): Promise<number[]> {
  const raw = await getPlayerSetting(ACCESS_KEY).catch(() => null);
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export async function setAccess(playerId: number, on: boolean): Promise<void> {
  const list = new Set(await accessList());
  if (on) list.add(playerId);
  else list.delete(playerId);
  await setPlayerSetting(ACCESS_KEY, JSON.stringify([...list]));
}

function envEmails(): Set<string> {
  return new Set(
    (process.env.WOLF_VISION_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Granted players: on the access list or in WOLF_VISION_EMAILS. They use Wolf Vision free of charge. */
export async function isGranted(player: { id: number; email: string }): Promise<boolean> {
  if (envEmails().has(player.email.toLowerCase())) return true;
  return (await accessList()).includes(player.id);
}

/** Can this player use Wolf Vision from their profile (outside the Arena)? */
export async function canUseFromProfile(player: { id: number; email: string }): Promise<boolean> {
  return process.env.WOLF_VISION_OPEN === "1" || (await isGranted(player));
}

/** What a session costs this player (0 = free). */
export async function priceFor(player: { id: number; email: string }, mode: WvMode): Promise<number> {
  if (!paywallOn() || (await isGranted(player))) return 0;
  return wolfVisionPrices()[mode];
}

// ── Sessions ──────────────────────────────────────────────────────────────

export const startSchema = z.object({
  kind: z.enum(["arena", "personal"]),
  mode: z.enum(["live", "upload"]),
  challengeId: z.number().int().positive().nullable().optional(),
});

export type StartResult =
  | { sessionId: number; status: "active"; priceCents: 0 }
  | { sessionId: number; status: "awaiting_payment"; priceCents: number; clientSecret: string };

export async function startSession(owner: { id: number; email: string; firstName: string; lastName: string }, input: z.infer<typeof startSchema>): Promise<StartResult> {
  await ensureWolfVisionTables();
  if (input.kind === "arena" && !input.challengeId) throw new WolfVisionError("bad_request");
  if (input.kind === "personal" && !(await canUseFromProfile(owner))) throw new WolfVisionError("no_access");
  const price = await priceFor(owner, input.mode);
  const status = price > 0 ? "awaiting_payment" : "active";
  const { rows } = await sql.query(
    `INSERT INTO ${T.sessions} (owner_id, kind, mode, challenge_id, status, price_cents, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'active' THEN NOW() ELSE NULL END) RETURNING id;`,
    [owner.id, input.kind, input.mode, input.challengeId ?? null, status, price],
  );
  const sessionId = rows[0].id as number;
  if (price === 0) return { sessionId, status: "active", priceCents: 0 };
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email: owner.email, limit: 1 });
  const customer = customers.data[0] ?? (await stripe.customers.create({ email: owner.email, name: `${owner.firstName} ${owner.lastName}`.trim() }));
  const intent = await stripe.paymentIntents.create(
    {
      amount: price,
      currency: "nzd",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      receipt_email: owner.email,
      description: `Three Wolves — Wolf Vision ${input.mode === "live" ? "live session" : "video analysis"}`,
      metadata: { type: "wolf_vision", sessionId: String(sessionId), playerId: String(owner.id), mode: input.mode },
    },
    { idempotencyKey: `wolf-vision-${PREFIX}${sessionId}` },
  );
  await sql.query(`UPDATE ${T.sessions} SET payment_intent = $2 WHERE id = $1;`, [sessionId, intent.id]);
  return { sessionId, status: "awaiting_payment", priceCents: price, clientSecret: intent.client_secret! };
}

type SessionRow = {
  id: number;
  owner_id: number;
  kind: WvKind;
  mode: WvMode;
  challenge_id: number | null;
  status: string;
  price_cents: number;
  payment_intent: string | null;
  refund_id: string | null;
  started_at: string | null;
  last_beat_at: string | null;
};

async function ownSession(ownerId: number, sessionId: number): Promise<SessionRow> {
  await ensureWolfVisionTables();
  const { rows } = await sql.query(`SELECT * FROM ${T.sessions} WHERE id = $1 AND owner_id = $2;`, [sessionId, ownerId]);
  if (!rows[0]) throw new WolfVisionError("not_found");
  return rows[0] as SessionRow;
}

export class WolfVisionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** After the card is confirmed in the browser: checks with Stripe, then the session can start. */
export async function confirmPaid(ownerId: number, sessionId: number): Promise<void> {
  const s = await ownSession(ownerId, sessionId);
  if (s.status !== "awaiting_payment") return;
  if (!s.payment_intent) throw new WolfVisionError("no_payment");
  const intent = await getStripe().paymentIntents.retrieve(s.payment_intent);
  if (intent.status !== "succeeded" || intent.metadata.sessionId !== String(sessionId)) throw new WolfVisionError("not_paid");
  await sql.query(`UPDATE ${T.sessions} SET status = 'active', started_at = NOW(), last_beat_at = NOW() WHERE id = $1 AND status = 'awaiting_payment';`, [sessionId]);
}

/** Webhook path: a Wolf Vision payment succeeded (covers a browser that closed before confirming). */
export async function markPaidFromWebhook(sessionId: number, intentId: string): Promise<void> {
  await ensureWolfVisionTables();
  await sql.query(
    `UPDATE ${T.sessions} SET status = 'active', started_at = COALESCE(started_at, NOW()), last_beat_at = COALESCE(last_beat_at, NOW())
     WHERE id = $1 AND payment_intent = $2 AND status = 'awaiting_payment';`,
    [sessionId, intentId],
  );
}

export async function beat(ownerId: number, sessionId: number, quality: number): Promise<void> {
  await ensureWolfVisionTables();
  await sql.query(`UPDATE ${T.sessions} SET last_beat_at = NOW(), quality = $3 WHERE id = $1 AND owner_id = $2 AND status = 'active';`, [sessionId, ownerId, quality]);
}

// ── Failures and refunds ──────────────────────────────────────────────────

export const failureSchema = z.object({ sessionId: z.number().int().positive(), reason: z.enum(TECHNICAL_FAILURES), detail: z.string().max(500).optional() });

export async function reportFailure(ownerId: number | null, sessionId: number, reason: TechnicalFailure, detail?: string): Promise<{ refunded: boolean; review: boolean }> {
  await ensureWolfVisionTables();
  const { rows } = await sql.query(`SELECT * FROM ${T.sessions} WHERE id = $1 ${ownerId === null ? "" : "AND owner_id = $2"};`, ownerId === null ? [sessionId] : [sessionId, ownerId]);
  const s = rows[0] as SessionRow | undefined;
  if (!s) throw new WolfVisionError("not_found");
  const paid = s.status !== "awaiting_payment" && s.price_cents > 0 && !!s.payment_intent;
  const recent = await sql.query(
    `SELECT count(*)::int AS n FROM ${T.sessions} WHERE owner_id = $1 AND refund_id IS NOT NULL AND refund_reason LIKE 'auto:%' AND ended_at > NOW() - INTERVAL '30 days';`,
    [s.owner_id],
  );
  const decision = refundDecision({ pricePaid: paid ? s.price_cents : 0, alreadyRefunded: !!s.refund_id, reason, recentAutoRefunds: recent.rows[0].n as number });
  let refundId: string | null = null;
  if (decision === "refund") {
    const refund = await getStripe().refunds.create(
      { payment_intent: s.payment_intent!, reason: "requested_by_customer", metadata: { type: "wolf_vision", sessionId: String(sessionId), failure: reason } },
      { idempotencyKey: `wolf-vision-refund-${PREFIX}${sessionId}` },
    );
    refundId = refund.id;
  }
  await sql.query(
    `UPDATE ${T.sessions} SET status = $2, failure = $3, refund_id = COALESCE($4, refund_id), refund_reason = CASE WHEN $4::text IS NULL THEN refund_reason ELSE $5 END, ended_at = COALESCE(ended_at, NOW())
     WHERE id = $1;`,
    [sessionId, decision === "refund" ? "refunded" : decision === "review" ? "review" : "failed", `${reason}${detail ? `: ${detail}` : ""}`.slice(0, 600), refundId, `auto:${reason}`],
  );
  return { refunded: decision === "refund", review: decision === "review" };
}

/** Daily: paid live sessions that stopped reporting mid-game and never finished count as dropped (technical). */
export async function sweepDroppedSessions(): Promise<{ checked: number; refunded: number; review: number }> {
  await ensureWolfVisionTables();
  const { rows } = await sql.query(
    `SELECT id FROM ${T.sessions} WHERE status = 'active' AND price_cents > 0 AND last_beat_at < NOW() - INTERVAL '${DROPPED_AFTER_MIN} minutes';`,
  );
  let refunded = 0, review = 0;
  for (const r of rows) {
    try {
      const out = await reportFailure(null, r.id as number, "dropped", "no heartbeat");
      if (out.refunded) refunded++;
      if (out.review) review++;
    } catch (err) {
      console.error("[wolf-vision] sweep", r.id, err);
    }
  }
  // Unpaid sessions left at the payment step: tidy away.
  await sql.query(`UPDATE ${T.sessions} SET status = 'cancelled' WHERE status = 'awaiting_payment' AND created_at < NOW() - INTERVAL '1 day';`);
  return { checked: rows.length, refunded, review };
}

// ── Results ───────────────────────────────────────────────────────────────

/** One player's line plus the match totals, as stored for (and shown to) that player. */
export type PlayerMatchStats = {
  kind: WvKind;
  mode: WvMode;
  challengeId: number | null;
  date: string;
  /** "Thu 20 Nov · Wolves vs Pack" style label. */
  title: string;
  team: 0 | 1;
  teams: [string, string];
  partner: string | null;
  opponents: string[];
  score: { mine: number | null; theirs: number | null } | null;
  me: { hits: number; distance: number; topSpeed: number };
  match: { duration: number; rallies: number; longestRally: number; avgRallyShots: number; fastestShotKmh: number | null; quality: number };
  everyone: { name: string; team: 0 | 1; hits: number; distance: number; topSpeed: number }[];
};

export const finishSchema = z.object({
  sessionId: z.number().int().positive(),
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  quality: z.number().min(0).max(1),
  trackedPlayers: z.number().int().min(0).max(4),
  /** Engine slot order: posting/near pair first, then the other pair. */
  players: z
    .array(
      z.object({
        name: z.string().max(80),
        team: z.union([z.literal(0), z.literal(1)]),
        playerId: z.number().int().positive().nullable(),
        hits: z.number().int().min(0).max(5000),
        distance: z.number().min(0).max(50_000),
        topSpeed: z.number().min(0).max(15),
      }),
    )
    .length(4),
  score: z.object({ team0: z.number().int().min(0).max(99).nullable(), team1: z.number().int().min(0).max(99).nullable() }).optional(),
  teams: z.tuple([z.string().max(80), z.string().max(80)]),
});

/**
 * Stores a finished session and gives every registered player in it their
 * own copy (their line plus the match totals). Players are emailed the first
 * time their copy is written (re-saving the same game does not email again).
 * Personal sessions store only the owner's line (the others are not linked
 * to accounts). Returns how many players received stats, and whether a paid
 * session was refunded for low quality.
 */
export async function finishSession(owner: { id: number }, input: z.infer<typeof finishSchema>): Promise<{ delivered: number; refunded: boolean }> {
  const s = await ownSession(owner.id, input.sessionId);
  if (s.status === "awaiting_payment") throw new WolfVisionError("not_paid");
  if (s.kind === "arena") {
    // Stats only ever go to this game's four players, partners together.
    const world = await loadWorld({ skipSync: true });
    const c = world.challenges.find((x) => x.id === s.challenge_id);
    if (!c || !c.acceptingPlayers) throw new WolfVisionError("not_found");
    const want = [[...c.postingPlayers].sort(), [...c.acceptingPlayers].sort()].map((x) => x.join(","));
    const got = [0, 1].map((tm) => input.players.filter((p) => p.team === tm).map((p) => p.playerId ?? 0).sort().join(","));
    if (!((got[0] === want[0] && got[1] === want[1]) || (got[0] === want[1] && got[1] === want[0]))) throw new WolfVisionError("wrong_players");
  } else {
    for (const p of input.players) if (p.playerId !== null && p.playerId !== owner.id) p.playerId = null;
  }
  const totalHits = input.players.reduce((a, p) => a + p.hits, 0);
  const failure = finishedSessionFailure({ quality: input.quality, trackedPlayers: input.trackedPlayers, duration: input.duration, hits: totalHits });
  const match = {
    duration: input.duration,
    rallies: input.rallies,
    longestRally: input.longestRally,
    avgRallyShots: input.avgRallyShots,
    fastestShotKmh: input.fastestShotKmh,
    quality: input.quality,
  };
  await sql.query(
    `UPDATE ${T.sessions} SET summary = $2, quality = $3, ended_at = NOW(), status = CASE WHEN status IN ('refunded', 'review') THEN status ELSE 'completed' END WHERE id = $1;`,
    [s.id, JSON.stringify({ ...match, players: input.players, teams: input.teams, score: input.score ?? null }), input.quality],
  );
  const date = new Date().toISOString();
  const everyone = input.players.map((p) => ({ name: p.name, team: p.team, hits: p.hits, distance: p.distance, topSpeed: p.topSpeed }));
  const recipients = input.players
    .map((p, slot) => ({ p, slot }))
    .filter(({ p, slot }) => (s.kind === "arena" ? p.playerId !== null : slot === input.players.findIndex((q) => q.playerId === owner.id)));
  let delivered = 0;
  for (const { p, slot } of recipients) {
    const team = p.team;
    const partner = input.players.find((q, k) => k !== slot && q.team === team)?.name ?? null;
    const opponents = input.players.filter((q) => q.team !== team).map((q) => q.name);
    const sc = input.score ? { mine: team === 0 ? input.score.team0 : input.score.team1, theirs: team === 0 ? input.score.team1 : input.score.team0 } : null;
    const copy: PlayerMatchStats = {
      kind: s.kind,
      mode: s.mode,
      challengeId: s.challenge_id,
      date,
      title: `${input.teams[team]} vs ${input.teams[1 - team]}`,
      team,
      teams: input.teams,
      partner,
      opponents,
      score: sc,
      me: { hits: p.hits, distance: p.distance, topSpeed: p.topSpeed },
      match,
      everyone,
    };
    const { rows } = await sql.query(
      `INSERT INTO ${T.stats} (session_id, player_id, team, slot, stats) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, player_id) DO UPDATE SET stats = EXCLUDED.stats, team = EXCLUDED.team, slot = EXCLUDED.slot
       RETURNING notified_at;`,
      [s.id, p.playerId ?? owner.id, team, slot, JSON.stringify(copy)],
    );
    delivered++;
    if (!rows[0].notified_at && s.kind === "arena") {
      await notifyPlayer(p.playerId!, copy).catch((err) => console.error("[wolf-vision] notify", err));
      await sql.query(`UPDATE ${T.stats} SET notified_at = NOW() WHERE session_id = $1 AND player_id = $2;`, [s.id, p.playerId]);
    }
  }
  let refunded = false;
  if (failure && s.price_cents > 0) refunded = (await reportFailure(owner.id, s.id, failure)).refunded;
  return { delivered, refunded };
}

async function notifyPlayer(playerId: number, st: PlayerMatchStats): Promise<void> {
  const { rows } = await sql.query(`SELECT email, lang FROM players WHERE id = $1 AND deleted_at IS NULL;`, [playerId]);
  const pl = rows[0] as { email: string; lang: string } | undefined;
  if (!pl) return;
  const vi = pl.lang === "vi";
  const m = st.match;
  const km = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);
  const lines = vi
    ? [
        `Wolf Vision đã ghi lại trận ${st.title}${st.score && st.score.mine !== null ? ` (${st.score.mine}–${st.score.theirs})` : ""}.`,
        `Của bạn: ${st.me.hits} cú đánh · ${km(st.me.distance)} di chuyển · tốc độ cao nhất ${st.me.topSpeed.toFixed(1)} m/s.`,
        `Cả trận: ${m.rallies} pha bóng · dài nhất ${m.longestRally} cú · trung bình ${m.avgRallyShots} cú/pha${m.fastestShotKmh != null ? ` · cú nhanh nhất ${m.fastestShotKmh} km/h` : ""}.`,
      ]
    : [
        `Wolf Vision tracked ${st.title}${st.score && st.score.mine !== null ? ` (${st.score.mine}–${st.score.theirs})` : ""}.`,
        `Your game: ${st.me.hits} hits · ${km(st.me.distance)} covered · top speed ${st.me.topSpeed.toFixed(1)} m/s.`,
        `The match: ${m.rallies} rallies · longest ${m.longestRally} shots · ${m.avgRallyShots} shots per rally${m.fastestShotKmh != null ? ` · fastest shot ${m.fastestShotKmh} km/h` : ""}.`,
      ];
  await sendPlayerNoticeEmail({
    to: pl.email,
    subject: vi ? `Thống kê Wolf Vision: ${st.title}` : `Your Wolf Vision stats: ${st.title}`,
    heading: vi ? "Thống kê trận đấu của bạn" : "Your match stats are in",
    lines,
    cta: { label: vi ? "Xem trong hồ sơ" : "See them in your profile", path: "/profile/player#wolf-vision" },
  });
}

/** A player's Wolf Vision games, newest first. */
export async function listPlayerStats(playerId: number, limit = 20): Promise<(PlayerMatchStats & { sessionId: number; unseen: boolean })[]> {
  if (!process.env.POSTGRES_URL) return [];
  await ensureWolfVisionTables();
  const { rows } = await sql.query(
    `SELECT s.session_id, s.stats, s.seen_at FROM ${T.stats} s JOIN ${T.sessions} x ON x.id = s.session_id
     WHERE s.player_id = $1 AND x.status IN ('completed', 'refunded', 'review', 'failed') ORDER BY s.created_at DESC LIMIT $2;`,
    [playerId, limit],
  );
  return rows.map((r) => ({ ...(r.stats as PlayerMatchStats), sessionId: r.session_id as number, unseen: !r.seen_at }));
}

export async function markStatsSeen(playerId: number): Promise<void> {
  await ensureWolfVisionTables();
  await sql.query(`UPDATE ${T.stats} SET seen_at = NOW() WHERE player_id = $1 AND seen_at IS NULL;`, [playerId]);
}

/** Admin view: recent sessions with payment and refund state. */
export async function listRecentSessions(limit = 30): Promise<{ id: number; owner: string; kind: string; mode: string; status: string; priceCents: number; failure: string | null; refunded: boolean; createdAt: string }[]> {
  await ensureWolfVisionTables();
  const { rows } = await sql.query(
    `SELECT x.*, COALESCE(NULLIF(p.display_name, ''), p.first_name || ' ' || p.last_name) AS owner_name FROM ${T.sessions} x JOIN players p ON p.id = x.owner_id
     ORDER BY x.created_at DESC LIMIT $1;`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    owner: r.owner_name,
    kind: r.kind,
    mode: r.mode,
    status: r.status,
    priceCents: r.price_cents,
    failure: r.failure,
    refunded: !!r.refund_id,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
