import { appRoute } from "@/lib/app-api";
import { defaultDisplayName } from "@/lib/player-db";

// What Settings shows about the account.
const route = appRoute("account.profile", async ({ player }) => {
  const fallback = defaultDisplayName(player.firstName, player.lastName, player.email);
  return {
    email: player.email,
    firstName: player.firstName,
    lastName: player.lastName,
    displayName: player.displayName,
    customDisplayName: player.displayName !== fallback,
    defaultDisplayName: fallback,
    lang: player.lang,
    phone: player.phone,
    phoneVerified: player.phoneVerified,
    avatarUrl: player.avatarUrl,
    leaderboardVisible: player.leaderboardVisible,
  };
});

export const GET = route.handle;
export const OPTIONS = route.preflight;
