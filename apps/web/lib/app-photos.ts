// The players' app's My photos (/api/v1/app/clubs/{club}/me/photos…): the
// website's own steps (lib/photos-service.ts, lib/photos-db.ts).
import type { Player } from "./player-db";
import { PHOTOS_PER_DAY, listPhotosForPlayer } from "./photos-db";
import { publicBlobUploadMode } from "./public-blob";

export async function myPhotos(player: Player) {
  const photos = await listPhotosForPlayer(player.id);
  return {
    photos: photos.map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, displayUrl: p.displayUrl, status: p.status, caption: p.caption, createdAt: p.createdAt })),
    uploadMode: publicBlobUploadMode(),
    perDay: PHOTOS_PER_DAY,
  };
}

export { deleteOwnPhoto, photoUploadAnswer, registerPhoto } from "./photos-service";
