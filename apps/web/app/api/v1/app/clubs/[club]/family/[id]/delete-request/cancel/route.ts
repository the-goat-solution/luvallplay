import { appRoute } from "@/lib/app-api";
import { familyCancelDelete } from "@/lib/juniors/app-rights";

// A guardian withdraws their request before the club has confirmed it.
const route = appRoute("family.cancelDelete", ({ player, club, params }) => familyCancelDelete(player, club, params.id));

export const POST = route.handle;
export const OPTIONS = route.preflight;
