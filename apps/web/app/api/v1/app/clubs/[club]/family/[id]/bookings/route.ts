import { appRoute } from "@/lib/app-api";
import { familyBook } from "@/lib/juniors/app-family";

// Book a place on a play day for this child. Only the child's own guardian.
const route = appRoute("family.book", ({ player, club, params, body }) => familyBook(player, club, params.id, body.date));

export const POST = route.handle;
export const OPTIONS = route.preflight;
