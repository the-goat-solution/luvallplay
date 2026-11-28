import { appRoute, fail } from "@/lib/app-api";
import { newAppSession } from "@/lib/app-api-session";
import { consumeAppHandover } from "@/lib/app-handover";
import { getPlayerById, recordPlayerEvent } from "@/lib/player-db";

// The cutover's handover (phase-4-cutover.md §4.1): the token the website made
// (/app-handover), swapped once for an app session for the same person. The
// session keeps the website session's sign-in time. Used, expired or unknown:
// 400 "invalid", and the app opens its sign-in instead.
const route = appRoute(
  "auth.handover",
  async ({ body, request }) => {
    const handed = await consumeAppHandover(body.token);
    if (!handed) return fail(400, "invalid");
    const player = await getPlayerById(handed.playerId);
    if (!player) return fail(400, "invalid");
    const session = await newAppSession(player.id, request.headers.get("user-agent"), handed.signedInAt);
    await recordPlayerEvent(player.id, "app_handover_used");
    return { ok: true as const, ...session, needsDetails: !player.firstName.trim(), phoneTaken: false };
  },
  { rateKey: (ip) => `auth-handover:${ip}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
