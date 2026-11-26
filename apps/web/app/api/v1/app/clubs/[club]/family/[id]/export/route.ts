import { appRoute } from "@/lib/app-api";
import { familyExport } from "@/lib/juniors/app-rights";

// Everything the club holds about this child, for their own guardian.
const route = appRoute("family.export", ({ player, club, params }) => familyExport(player, club, params.id));

export const GET = route.handle;
export const OPTIONS = route.preflight;
