import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { PHOTOS_PER_DAY, countPhotosToday, insertPhoto, setPhotoModeration } from "@/lib/photos-db";
import { moderateImage } from "@/lib/photo-moderation";
import { sendAdminAlertEmail } from "@/lib/player-email";
import { emitToPlayers } from "@/lib/webhooks";

const url = z.string().url().max(500);
const bodySchema = z.object({
  originalUrl: url,
  displayUrl: url,
  thumbUrl: url,
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
  bytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
  caption: z.string().trim().max(140).nullable().optional(),
  consent: z.literal(true),
});

/** Only files in this player's own folder of our public Blob store. */
function ownBlob(raw: string, playerId: number): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com") && u.pathname.startsWith(`/photos/${playerId}/`);
  } catch {
    return false;
  }
}

// Registers an uploaded photo, runs the SafeSearch check and files it:
// approved → Gallery; doubtful → waits for an admin; inappropriate →
// hidden everywhere and the admins are emailed.
export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (![body.originalUrl, body.displayUrl, body.thumbUrl].every((u) => ownBlob(u, player.id))) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if ((await countPhotosToday(player.id)) >= PHOTOS_PER_DAY) {
    return NextResponse.json({ error: "daily_limit" }, { status: 429 });
  }
  const id = await insertPhoto({
    playerId: player.id,
    originalUrl: body.originalUrl,
    displayUrl: body.displayUrl,
    thumbUrl: body.thumbUrl,
    width: body.width,
    height: body.height,
    bytes: body.bytes,
    caption: body.caption || null,
  });
  const result = await moderateImage(body.displayUrl, body.originalUrl);
  await setPhotoModeration(id, result.status, result.safesearch);
  const who = `${player.firstName} ${player.lastName}`.trim() || player.email;
  if (result.status === "rejected") {
    await sendAdminAlertEmail({
      subject: `Photo blocked: uploaded by ${who}`,
      heading: "A photo was blocked by the safety check",
      lines: [
        `${who} (${player.email}) uploaded a photo that Google's SafeSearch rated as inappropriate. It's hidden everywhere and was not shared.`,
        `Ratings: ${Object.entries(result.safesearch ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ],
      cta: { label: "Review in Admin → Photos", path: "/admin/photos?tab=blocked" },
    }).catch((err) => console.error("[photos] alert failed:", err));
  } else if (result.status === "needs_review") {
    await sendAdminAlertEmail({
      subject: `Photo to review from ${who}`,
      heading: "A shared photo is waiting for review",
      lines: [result.reason === "checked" ? "SafeSearch wasn't sure about it, so it's held until an admin approves it." : "The automatic check isn't available right now, so it's held until an admin approves it."],
      cta: { label: "Review in Admin → Photos", path: "/admin/photos" },
    }).catch((err) => console.error("[photos] alert failed:", err));
  } else {
    revalidatePath("/");
    revalidatePath("/gallery");
    await emitToPlayers([player.email], "photo.approved", () => ({ photoId: id, url: body.displayUrl }));
  }
  revalidatePath("/profile/player");
  return NextResponse.json({ ok: true, id, status: result.status });
}
