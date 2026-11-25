// A photo from the phone, cut square from the middle and shrunk to 512 px
// (never enlarged), as the website does (AvatarCard). Read through a data:
// URL, which the page's Content-Security-Policy allows (blob: URLs it
// doesn't).
const SIZE = 512;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });
}

/** The square picture as a data URL: WebP, or JPEG where WebP can't be made. */
export async function squarePhoto(file: File): Promise<string> {
  const img = new Image();
  img.decoding = "async";
  img.src = await readAsDataUrl(file);
  await img.decode();
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error("empty");
  const canvas = document.createElement("canvas");
  const out = Math.min(SIZE, side);
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
  const webp = canvas.toDataURL("image/webp", 0.88);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88);
}
