import { appRoute } from "@/lib/app-api";
import { connectedApps } from "@/lib/app-account";

// Connected apps: the person's access keys and webhooks (never the keys or secrets themselves).
const route = appRoute("integrations.list", async ({ player }) => connectedApps(player.id));

export const GET = route.handle;
export const OPTIONS = route.preflight;
