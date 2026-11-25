import { appRoute } from "@/lib/app-api";
import { visionStatus } from "@/lib/app-vision";

// Vision: free during the trial, otherwise a usable pass for this kind, and the prices.
const route = appRoute("vision.status", async ({ player, query }) => visionStatus(player, query.kind));

export const GET = route.handle;
export const OPTIONS = route.preflight;
