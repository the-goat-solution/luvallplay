import { appRoute } from "@/lib/app-api";
import { familyForms } from "@/lib/juniors/app-forms";

// The club's current forms and waivers for this child, with this guardian's signatures.
const route = appRoute("family.forms", ({ player, club, params }) => familyForms(player, club, params.id));

export const GET = route.handle;
export const OPTIONS = route.preflight;
