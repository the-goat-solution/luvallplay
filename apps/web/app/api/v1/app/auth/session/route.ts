import { appRoute } from "@/lib/app-api";

// Who this token (or cookie) belongs to. The app calls it on start.
const route = appRoute("auth.session", async ({ player, session }) => ({
  player: {
    id: player.id,
    email: player.email,
    firstName: player.firstName,
    lastName: player.lastName,
    displayName: player.displayName,
    lang: player.lang,
    avatarUrl: player.avatarUrl,
    phoneVerified: player.phoneVerified,
  },
  signedInAt: session!.signedInAt.toISOString(),
}));

export const GET = route.handle;
export const OPTIONS = route.preflight;
