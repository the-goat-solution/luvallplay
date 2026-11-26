import { appRoute } from "@/lib/app-api";
import { familyCareContacts } from "@/lib/juniors/app-care";

// Replace the child's emergency contacts, in calling order.
const route = appRoute("family.careContacts", ({ player, club, params, body }) => familyCareContacts(player, club, params.id, body.contacts));

export const PUT = route.handle;
export const OPTIONS = route.preflight;
