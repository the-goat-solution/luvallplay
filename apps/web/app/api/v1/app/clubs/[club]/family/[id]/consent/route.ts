import { appRoute } from "@/lib/app-api";
import { familyConsent } from "@/lib/juniors/app-family";

// What this guardian allows for the child (the board, photos, match video),
// item by item. Items not named keep their answer.
const route = appRoute("family.consent", ({ player, club, params, body }) => familyConsent(player, club, params.id, body));

export const PUT = route.handle;
export const OPTIONS = route.preflight;
