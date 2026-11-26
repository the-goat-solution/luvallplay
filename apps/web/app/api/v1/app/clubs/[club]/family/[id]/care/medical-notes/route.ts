import { appRoute } from "@/lib/app-api";
import { familyCareNotes } from "@/lib/juniors/app-care";

// Save the child's medical note (encrypted before it is stored). Empty text removes it.
const route = appRoute("family.careNotes", ({ player, club, params, body }) => familyCareNotes(player, club, params.id, body.notes));

export const PUT = route.handle;
export const OPTIONS = route.preflight;
