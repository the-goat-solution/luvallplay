import { appRoute, fail } from "@/lib/app-api";
import { deleteOwnPhoto } from "@/lib/app-photos";

// Deleting one of your photos: it leaves the Gallery and its files go.
const route = appRoute("photos.delete", async ({ player, params }) => ((await deleteOwnPhoto(player.id, params.id)) ? { ok: true as const } : fail(404, "not_found")));

export const DELETE = route.handle;
export const OPTIONS = route.preflight;
