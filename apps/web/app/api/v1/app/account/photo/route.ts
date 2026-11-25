import { appRoute, fail } from "@/lib/app-api";
import { removePhoto, savePhoto } from "@/lib/app-account";

// The profile picture: the website's /api/profile/avatar rules and limits
// (the same rate-limit bucket), from a data URL the app has already shrunk.
const save = appRoute(
  "account.photo",
  async ({ player, body }) => {
    const result = await savePhoto(player.id, body.image);
    return result.ok ? { ok: true as const, url: result.url } : fail(result.status, result.code);
  },
  { rateKey: (_ip, session) => `avatar:${session?.player.id}` },
);

const remove = appRoute(
  "account.removePhoto",
  async ({ player }) => {
    await removePhoto(player.id);
    return { ok: true as const, url: null };
  },
  { rateKey: (_ip, session) => `avatar:${session?.player.id}` },
);

export const POST = save.handle;
export const DELETE = remove.handle;
export const OPTIONS = save.preflight;
