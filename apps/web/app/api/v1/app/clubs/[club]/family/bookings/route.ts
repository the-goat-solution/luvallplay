import { appRoute } from "@/lib/app-api";
import { familyBookings } from "@/lib/juniors/app-family";

// The play days a child could be booked on, and the guardian's own children's bookings.
const route = appRoute("family.bookings", ({ player, club }) => familyBookings(player, club));

export const GET = route.handle;
export const OPTIONS = route.preflight;
