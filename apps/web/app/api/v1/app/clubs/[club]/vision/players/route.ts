import { appRoute } from "@/lib/app-api";
import { visionPlayers } from "@/lib/app-vision";

// The players a game can be set up with: display name and picture only, never an email.
const route = appRoute("vision.players", async ({ player }) => visionPlayers(player));

export const GET = route.handle;
export const OPTIONS = route.preflight;
