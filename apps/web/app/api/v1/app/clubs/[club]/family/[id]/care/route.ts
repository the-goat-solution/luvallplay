import { appRoute } from "@/lib/app-api";
import { familyCare } from "@/lib/juniors/app-care";

// A child's emergency contacts and medical note, for their own guardian only.
const route = appRoute("family.care", ({ player, club, params }) => familyCare(player, club, params.id));

export const GET = route.handle;
export const OPTIONS = route.preflight;
