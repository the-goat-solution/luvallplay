import { appRoute } from "@/lib/app-api";
import { refreshLeaderboard } from "@/lib/app-account";
import { updatePlayerProfile } from "@/lib/player-db";

// Name and display name, as the website's details form saves them. The phone
// number and language are passed through unchanged, so the number keeps its
// confirmation (changing the number is a separate, sign-in step).
const route = appRoute("account.details", async ({ player, body }) => {
  await updatePlayerProfile(player.id, {
    firstName: body.firstName,
    lastName: body.lastName,
    displayName: body.displayName?.trim() || null,
    phone: player.phone,
    lang: player.lang,
  });
  refreshLeaderboard();
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
