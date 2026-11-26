// The players' app Vision tab (/api/v1/app/clubs/{club}/vision…): the
// website's Wolf Vision status, challenge set-up, player picker and
// labelling set, from the same functions (lib/wolf-vision-*.ts,
// lib/match-stats-db.ts, lib/repos/players.ts), and the tracker's own
// calls, with the answers and error codes of the website's routes
// (app/api/wolf-vision/*, app/api/arena/match-stats).
import type { BodyOf, QueryOf } from "@luvallplay/api/contract";
import { SHUTTLE_CHECKER } from "@luvallplay/vision/checker-model";
import { appReturnOrigin, fail, type AppApiError } from "./app-api";
import { ArenaError, invalidateWorld } from "./arena-db";
import { visionName } from "./club-terms";
import { getSiteUrl } from "./email-layout";
import { heartbeatTracking, loadMatchSetup, saveMatchStats } from "./match-stats-db";
import type { Player } from "./player-db";
import { listPlayersForPicker } from "./repos/players";
import { createVisionCheckout, visionCheckoutPaid } from "./stripe";
import {
  PASS_PRICE_CENTS,
  attachStripeSession,
  consumePass,
  createPass,
  latestModel,
  markPassPaid,
  saveLabels,
  submitCheckerUpdate,
  usablePass,
  type PassKind,
} from "./wolf-vision-db";
import { shareStats } from "./wolf-vision-share";
import { WV_TRIAL_ENDS_ISO, isTrial } from "./wolf-vision-trial";

/** Production only charges real money (as the website's pass route). */
const live = () => process.env.VERCEL_ENV === "production" && !!process.env.STRIPE_SECRET_KEY;

export async function visionStatus(player: Player, kind: PassKind | undefined) {
  const trial = isTrial();
  return {
    trial,
    trialEnds: WV_TRIAL_ENDS_ISO,
    pass: !trial && kind ? await usablePass(player.id, kind) : null,
    prices: { live: PASS_PRICE_CENTS.live, upload: PASS_PRICE_CENTS.upload },
    testMode: !live(),
  };
}

export async function visionChallenge(id: number) {
  try {
    return await loadMatchSetup(id);
  } catch (err) {
    if (err instanceof ArenaError) return null;
    throw err;
  }
}

export async function visionPlayers(me: Player) {
  return { players: (await listPlayersForPicker()).map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl ?? null, me: p.id === me.id })) };
}

export { saveLabels };

// ── Passes (after the free trial) ───────────────────────────────────────────

/** The player's usable pass; after Checkout, confirms the payment first. */
export async function passState(player: Player, q: QueryOf<"vision.pass">) {
  if (isTrial()) return { trial: true, pass: null, priceCents: null, testMode: false };
  if (q.session_id && live()) {
    try {
      if (await visionCheckoutPaid(q.session_id)) await markPassPaid(q.session_id);
    } catch (err) {
      console.error("[app-vision] checkout check failed", err);
    }
  }
  return { pass: await usablePass(player.id, q.kind), priceCents: PASS_PRICE_CENTS[q.kind], testMode: !live() };
}

/** Buys a pass: a free test pass outside production, else Checkout coming back to the app. */
export async function buyPass(player: Player, body: BodyOf<"vision.buy">, request: Request): Promise<{ url?: string; pass?: Awaited<ReturnType<typeof createPass>>; testMode?: boolean } | AppApiError> {
  if (isTrial()) return fail(409, "free_trial", { trialEnds: WV_TRIAL_ENDS_ISO });
  const kind = body.kind;
  if (!live()) return { pass: await createPass(player.id, kind, { test: true, challengeId: body.challengeId }), testMode: true };
  const pass = await createPass(player.id, kind, { test: false, challengeId: body.challengeId });
  // Back to the tracker in the app (same challenge, if any), or to the website's.
  const origin = appReturnOrigin(request.headers.get("origin"));
  const rt = body.returnTo;
  const back = origin ? `${origin}${rt && rt.startsWith("/vision") ? rt : "/vision"}` : `${getSiteUrl()}/profile/wolf-vision`;
  const sep = back.includes("?") ? "&" : "?";
  const cs = await createVisionCheckout({
    kind,
    amountCents: PASS_PRICE_CENTS[kind],
    name: kind === "live" ? `${visionName()} AI tracker: live match` : `${visionName()} AI tracker: video analysis`,
    description: kind === "live" ? "AI-enhanced tracking of one live doubles match on your phone." : "AI-enhanced analysis of one uploaded match video.",
    email: player.email,
    passId: pass.id,
    playerId: player.id,
    successUrl: `${back}${sep}wv_paid=${kind}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: back,
  });
  await attachStripeSession(pass.id, cs.id);
  return cs.url ? { url: cs.url } : fail(502, "failed");
}

/** Starts a session on a pass (a resume within the window reuses it). */
export async function usePass(player: Player, body: BodyOf<"vision.use">) {
  if (isTrial()) return { trial: true, pass: null };
  const pass = await consumePass(player.id, body.passId);
  return pass ? { pass } : fail(402, "no_pass");
}

// ── A challenge's stats ─────────────────────────────────────────────────────

export async function saveStats(player: Player, body: BodyOf<"vision.save">) {
  try {
    const stats = await saveMatchStats({ id: player.id }, body);
    invalidateWorld();
    return { ok: true as const, stats };
  } catch (err) {
    if (err instanceof ArenaError) return fail(409, err.code);
    throw err;
  }
}

export async function heartbeat(player: Player, body: BodyOf<"vision.beat">) {
  try {
    await heartbeatTracking({ id: player.id }, body);
    invalidateWorld();
    return { ok: true as const };
  } catch (err) {
    if (err instanceof ArenaError) return fail(409, err.code);
    throw err;
  }
}

// ── The shared hit checker ──────────────────────────────────────────────────

export async function sharedModel() {
  try {
    return { model: await latestModel("checker") };
  } catch (err) {
    console.error("[app-vision] model load failed", err);
    return { model: null };
  }
}

export async function trainModel(player: Player, body: BodyOf<"vision.train">) {
  if (!SHUTTLE_CHECKER) return fail(409, "no_base_model");
  if (body.weights.w1.length !== SHUTTLE_CHECKER.w1.length) return fail(400, "bad_request");
  const base = (await latestModel("checker"))?.weights ?? SHUTTLE_CHECKER;
  return { ok: true as const, ...(await submitCheckerUpdate(player.id, base, body)) };
}

// ── Stats by email (a session that isn't a challenge) ───────────────────────

export async function share(player: Player, body: BodyOf<"vision.share">) {
  const r = await shareStats(player, body, () => true);
  if ("error" in r.json) return fail(r.status, r.json.error);
  const json = { ok: r.json.ok, sent: r.json.sent, failed: r.json.failed ?? [] };
  return r.status === 200 ? json : fail(r.status, "send_failed", json);
}
