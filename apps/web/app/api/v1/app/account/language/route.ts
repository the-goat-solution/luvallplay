import { appRoute } from "@/lib/app-api";
import { setPlayerLang } from "@/lib/repos/players";

// The language for the app, the website and the club's emails.
const route = appRoute("account.language", async ({ player, body }) => {
  await setPlayerLang(player.id, body.lang);
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
