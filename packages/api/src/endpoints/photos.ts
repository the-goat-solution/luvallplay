// The `photos.*` endpoints of the players' app API.
import { defineEndpoints, MIN } from "../endpoint.ts";
import * as S from "../schemas.ts";

export const photosEndpoints = defineEndpoints("photos", {
  // My photos (module gallery): the website's /api/profile/photos routes.
  "photos.list": {
    method: "GET", path: "/clubs/{club}/me/photos", auth: "session", scope: "club", module: "gallery",
    params: S.clubParams, response: S.photosResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
  "photos.upload": {
    method: "POST", path: "/clubs/{club}/me/photos/upload", auth: "session", scope: "club", module: "gallery",
    params: S.clubParams, body: S.photoUploadRequest, response: S.photoUploadResponse,
    rateLimit: { limit: 120, windowMs: MIN },
  },
  "photos.add": {
    method: "POST", path: "/clubs/{club}/me/photos", auth: "session", scope: "club", module: "gallery",
    params: S.clubParams, body: S.photoAddRequest, response: S.photoAddResponse,
    rateLimit: { limit: 40, windowMs: MIN },
  },
  "photos.delete": {
    method: "DELETE", path: "/clubs/{club}/me/photos/{id}", auth: "session", scope: "club", module: "gallery",
    params: S.photoParams, response: S.okResponse,
    rateLimit: { limit: 60, windowMs: MIN },
  },
});
