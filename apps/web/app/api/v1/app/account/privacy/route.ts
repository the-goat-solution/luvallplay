import { appRoute } from "@/lib/app-api";
import { refreshLeaderboard } from "@/lib/app-account";
import { setLeaderboardVisible } from "@/lib/player-db";

// "Show me on the leaderboard", as the website's /api/profile/privacy.
const route = appRoute("account.privacy", async ({ player, body }) => {
  await setLeaderboardVisible(player.id, body.leaderboardVisible);
  refreshLeaderboard();
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
