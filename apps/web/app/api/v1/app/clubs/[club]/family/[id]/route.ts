import { appRoute } from "@/lib/app-api";
import { familyUpdate } from "@/lib/juniors/app-family";

// Correct a child's name or birth year. Only the child's own guardian.
const route = appRoute("family.update", ({ player, club, params, body }) => familyUpdate(player, club, params.id, body));

export const PATCH = route.handle;
export const OPTIONS = route.preflight;
