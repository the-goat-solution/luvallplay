import { appRoute } from "@/lib/app-api";
import { familyRequestDelete } from "@/lib/juniors/app-rights";

// A guardian asks the club to delete their child's information. Nothing is removed until an owner or admin confirms.
const route = appRoute("family.requestDelete", ({ player, club, params, body }) => familyRequestDelete(player, club, params.id, body.confirm));

export const POST = route.handle;
export const OPTIONS = route.preflight;
