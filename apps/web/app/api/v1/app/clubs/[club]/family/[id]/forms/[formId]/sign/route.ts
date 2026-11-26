import { appRoute } from "@/lib/app-api";
import { familySignForm } from "@/lib/juniors/app-forms";

// Sign the current version of a form for this child. Only the child's own guardian.
const route = appRoute("family.signForm", ({ player, club, params, body }) => familySignForm(player, club, params.id, params.formId, body.name));

export const POST = route.handle;
export const OPTIONS = route.preflight;
