import { appRoute } from "@/lib/app-api";
import { meHome } from "@/lib/app-me";

// The Me tab: who they are, their membership or the way to join, the next
// five weeks of play days, their inbox and the welcome card.
const route = appRoute("me.home", ({ player, club }) => meHome(player, club));

export const GET = route.handle;
export const OPTIONS = route.preflight;
