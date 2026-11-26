import { appRoute } from "@/lib/app-api";
import { familyCancelBooking } from "@/lib/juniors/app-family";

// Cancel a child's booking. Any current guardian of the child.
const route = appRoute("family.cancelBooking", ({ player, club, params }) => familyCancelBooking(player, club, params.id));

export const POST = route.handle;
export const OPTIONS = route.preflight;
