import { appRoute } from "@/lib/app-api";
import { familyRemove } from "@/lib/juniors/app-rights";

// The older "delete now" endpoint. Deleting needs the club's confirmation, so it deletes nothing: 409 ask_the_club.
const route = appRoute("family.remove", () => familyRemove());

export const POST = route.handle;
export const OPTIONS = route.preflight;
