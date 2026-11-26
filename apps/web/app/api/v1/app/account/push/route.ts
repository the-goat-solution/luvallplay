import { appRoute } from "@/lib/app-api";
import { pushOverview } from "@/lib/app-push";

// Whether notifications can be sent from here, how many of the person's
// devices receive them, and which kinds they asked for.
const route = appRoute("account.push", async ({ player }) => pushOverview(player.id));

export const GET = route.handle;
export const OPTIONS = route.preflight;
