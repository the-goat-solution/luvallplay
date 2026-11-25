// The players' app Vision tab (/api/v1/app/clubs/{club}/vision…): the
// website's Wolf Vision status, challenge set-up, player picker and
// labelling set, from the same functions (lib/wolf-vision-*.ts,
// lib/match-stats-db.ts, lib/repos/players.ts).
import { ArenaError } from "./arena-db";
import { loadMatchSetup } from "./match-stats-db";
import type { Player } from "./player-db";
import { listPlayersForPicker } from "./repos/players";
import { PASS_PRICE_CENTS, saveLabels, usablePass, type PassKind } from "./wolf-vision-db";
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
