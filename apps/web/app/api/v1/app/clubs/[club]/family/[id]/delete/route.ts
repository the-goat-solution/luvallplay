import { appRoute } from "@/lib/app-api";
import { familyRemove } from "@/lib/juniors/app-rights";

// Delete this child's information for good. Only the child's own guardian, and only with `confirm: true`.
const route = appRoute("family.remove", ({ player, club, params, body }) => familyRemove(player, club, params.id, body.confirm));

export const POST = route.handle;
export const OPTIONS = route.preflight;
