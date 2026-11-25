import { appRoute, fail } from "@/lib/app-api";
import { arenaAction, arenaState } from "@/lib/app-arena";

// The Arena tab: GET is the board the app polls while the tab is open; POST
// runs one action and answers with the fresh board (and a code to show when
// the action made one). The website's /api/arena rules and rate-limit bucket.
const read = appRoute("arena.state", async ({ player }) => arenaState(player.id));

const act = appRoute(
  "arena.action",
  async ({ player, body }) => {
    const r = await arenaAction(player.id, body);
    return r.ok ? { ok: true as const, code: r.code, state: r.state } : fail(409, r.code);
  },
  { rateKey: (_ip, session) => `arena:${session?.player.id}` },
);

export const GET = read.handle;
export const POST = act.handle;
export const OPTIONS = read.preflight;
