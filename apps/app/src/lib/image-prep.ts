import { stripJpegGps } from "@luvallplay/core/exif-gps";

// Runs on the device before a photo uploads (the same steps as the website's
// components/profile/player/imagePrep.ts): the full-quality original
// (with GPS location removed), a ~1600px display copy and a ~480px
// thumbnail. Doing it here means no server image processing at all.

export type PreparedPhoto = {
  original: Blob;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
};

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
  if (webp && webp.type === "image/webp") return webp;
  // Older Safari can't encode WebP: JPEG instead.
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!jpeg) throw new Error("encode");
  return jpeg;
}

function draw(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  // EXIF orientation is applied, so phone photos come out the right way up.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let original: Blob;
    if (file.type === "image/jpeg") {
      const { bytes } = stripJpegGps(new Uint8Array(await file.arrayBuffer()));
      original = new Blob([bytes as BlobPart], { type: "image/jpeg" });
    } else {
      // PNG/WebP/HEIC: re-encode at high quality, which drops all metadata.
      const full = draw(bitmap, 6000);
      const jpeg = await new Promise<Blob | null>((r) => full.toBlob(r, "image/jpeg", 0.95));
      if (!jpeg) throw new Error("encode");
      original = jpeg;
    }
    const display = await encode(draw(bitmap, 1600));
    const thumb = await encode(draw(bitmap, 480));
    return { original, display, thumb, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
