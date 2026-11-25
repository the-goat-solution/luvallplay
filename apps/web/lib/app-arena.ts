// The players' app Arena (/api/v1/app/clubs/{club}/arena): the website's
// snapshot (lib/arena-state.ts) and the same actions as its POST /api/arena,
// from the same functions in lib/arena-db.ts.
import type { BodyOf } from "@luvallplay/api/contract";
import {
  ArenaError,
  acceptChallenge,
  answerAfterGame,
  callOffChallenge,
  cancelChallenge,
  cancelPairRequest,
  checkInNow,
  confirmScore,
  createPairCode,
  createPairInvite,
  disputeScore,
  enterPairCode,
  enterScore,
  invalidateWorld,
  joinPairInvite,
  leavePair,
  markRankSeen,
  postChallenge,
  renamePair,
  respondPairRequest,
} from "./arena-db";
import { buildArenaState, type ArenaState } from "./arena-state";

export type ArenaAction = BodyOf<"arena.action">;
type Code = { code: string; expiresAt: string } | null;
export type ArenaResult = { ok: true; code: Code; state: ArenaState } | { ok: false; code: string };

/** The board as this person sees it; polling may get a copy up to 3 s old (their own status is always fresh). */
export function arenaState(playerId: number): Promise<ArenaState> {
  return buildArenaState({ id: playerId }, { maxAgeMs: 3000 });
}

async function run(playerId: number, a: ArenaAction): Promise<Code> {
  switch (a.action) {
    case "pair_code": return createPairCode(playerId);
    case "pair_enter": await enterPairCode(playerId, a.code); return null;
    case "pair_invite": return createPairInvite(playerId);
    case "pair_join": await joinPairInvite(playerId, a.code); return null;
    case "checkin_now": await checkInNow(playerId, a.id); return null;
    case "pair_respond": await respondPairRequest(playerId, a.accept); return null;
    case "pair_cancel": await cancelPairRequest(playerId); return null;
    case "pair_leave": await leavePair(playerId); return null;
    case "pair_rename": await renamePair(playerId, a.name); return null;
    case "post": await postChallenge(playerId, a.days, a.note ?? ""); return null;
    case "cancel": await cancelChallenge(playerId, a.id); return null;
    case "accept": await acceptChallenge(playerId, a.id); return null;
    case "call_off": await callOffChallenge(playerId, a.id); return null;
    case "score": await enterScore(playerId, a.id, { posting: a.posting, accepting: a.accepting }); return null;
    case "retired": await enterScore(playerId, a.id, { retiredBy: a.retiredBy }); return null;
    case "confirm": await confirmScore(playerId, a.id); return null;
    case "dispute": await disputeScore(playerId, a.id, a.note ?? ""); return null;
    case "after": await answerAfterGame(playerId, a.id, a.keep, a.again); return null;
    case "rank_seen": await markRankSeen(playerId); return null;
  }
}

/** One action, then the fresh board. A rule the Arena refuses comes back as its code (409). */
export async function arenaAction(playerId: number, action: ArenaAction): Promise<ArenaResult> {
  invalidateWorld();
  try {
    const code = await run(playerId, action);
    invalidateWorld();
    return { ok: true, code: code ?? null, state: await buildArenaState({ id: playerId }) };
  } catch (err) {
    invalidateWorld();
    if (err instanceof ArenaError) return { ok: false, code: err.code };
    throw err;
  }
}
