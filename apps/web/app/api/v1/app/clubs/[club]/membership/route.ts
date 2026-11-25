import { appRoute, fail } from "@/lib/app-api";
import { membershipAction, membershipState } from "@/lib/app-membership";

// The membership and what can be done with it (GET), and one change (POST):
// the website's /api/profile/membership/action, same rules and rate-limit bucket.
const read = appRoute("membership.state", async ({ player, club }) => membershipState(player, club));

const act = appRoute(
  "membership.action",
  async ({ player, body }) => {
    const r = await membershipAction(player, body);
    if (!r.ok) return fail(r.status, r.code);
    return r as { ok: true };
  },
  { rateKey: (_ip, session) => `membership-action:${session?.player.id}` },
);

export const GET = read.handle;
export const POST = act.handle;
export const OPTIONS = read.preflight;
