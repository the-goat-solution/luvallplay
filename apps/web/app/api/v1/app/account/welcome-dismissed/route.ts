import { appRoute } from "@/lib/app-api";
import { recordPlayerEvent } from "@/lib/player-db";
import { markWelcomeDismissed } from "@/lib/repos/players";

// The welcome card's "Done", as the web's /api/profile/event does it.
const route = appRoute("account.dismissWelcome", async ({ player }) => {
  await markWelcomeDismissed(player.id);
  await recordPlayerEvent(player.id, "welcome_dismissed");
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
