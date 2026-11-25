import { appRoute } from "@/lib/app-api";
import { collectPlayerData } from "@/lib/player-export";

// "Download my data" (NZ Privacy Act 2020): everything the club holds under
// this account, as the website's /api/profile/export.
const route = appRoute("account.export", ({ player }) => collectPlayerData(player));

export const GET = route.handle;
export const OPTIONS = route.preflight;
