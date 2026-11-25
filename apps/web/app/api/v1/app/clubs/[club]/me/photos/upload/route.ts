import { appRoute, fail } from "@/lib/app-api";
import { photoUploadAnswer } from "@/lib/app-photos";

// The photo store's upload handshake for the app's Blob client: only into
// the player's own folder, only images, at most 20 a day (as the website's
// /api/profile/photos/upload).
const route = appRoute("photos.upload", async ({ player, body, request }) => {
  const r = await photoUploadAnswer(request, player.id, body);
  if (r.status !== 200) return fail(r.status, String(r.json.error ?? "failed"));
  return r.json;
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
