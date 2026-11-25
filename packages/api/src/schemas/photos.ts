// My photos (module gallery).
import { z } from "zod";
import { clubParams } from "./clubs.ts";

export const photoSchema = z.object({
  id: z.number().int(),
  thumbUrl: z.string(),
  displayUrl: z.string(),
  status: z.enum(["pending", "approved", "needs_review", "rejected", "hidden"]),
  caption: z.string().nullable(),
  createdAt: z.string(),
});
export const photosResponse = z.object({
  photos: z.array(photoSchema),
  /** How the device uploads ("token" or "presigned"), or null when no photo store is connected yet. */
  uploadMode: z.enum(["token", "presigned"]).nullable(),
  perDay: z.number().int(),
});
/** The Blob client's own upload handshake, passed through as it is. */
export const photoUploadRequest = z.record(z.string(), z.unknown());
export const photoUploadResponse = z.record(z.string(), z.unknown());
const photoUrl = z.string().url().max(500);
export const photoAddRequest = z.object({
  originalUrl: photoUrl,
  displayUrl: photoUrl,
  thumbUrl: photoUrl,
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
  bytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
  caption: z.string().trim().max(140).nullable().optional(),
  consent: z.literal(true),
});
export const photoAddResponse = z.object({ ok: z.literal(true), id: z.number().int(), status: z.enum(["pending", "approved", "needs_review", "rejected", "hidden"]) });
export const photoParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
