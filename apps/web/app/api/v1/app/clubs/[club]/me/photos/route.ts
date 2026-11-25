import { appRoute, fail } from "@/lib/app-api";
import { myPhotos, registerPhoto } from "@/lib/app-photos";

// My photos: the list (GET) and registering one uploaded straight to the
// photo store (POST: the safety check, then the Gallery, an admin's review
// or hidden), as the website's /api/profile/photos.
const list = appRoute("photos.list", async ({ player }) => myPhotos(player));
const add = appRoute(
  "photos.add",
  async ({ player, body }) => {
    const r = await registerPhoto(player, body);
    if (r.status !== 200) return fail(r.status, String(r.json.error ?? "failed"));
    return r.json as { ok: true; id: number; status: "approved" | "needs_review" | "rejected" | "pending" | "hidden" };
  },
  { badRequestCode: "invalid" },
);

export const GET = list.handle;
export const POST = add.handle;
export const OPTIONS = list.preflight;
