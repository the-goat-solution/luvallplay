import { appRoute, fail } from "@/lib/app-api";
import { visionChallenge } from "@/lib/app-vision";

// A challenge to track: its two teams, the score, and stats already saved.
const route = appRoute("vision.challenge", async ({ params }) => (await visionChallenge(params.id)) ?? fail(404, "not_found"));

export const GET = route.handle;
export const OPTIONS = route.preflight;
