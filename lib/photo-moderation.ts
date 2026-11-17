import { JWT } from "google-auth-library";
import type { PhotoStatus } from "./photos-db";
import { decide } from "./moderation-rules";

export { decide } from "./moderation-rules";

// Google Cloud Vision SafeSearch, using the club's existing Google service
// account (the one that reads the calendar). Free for the first 1,000
// images a month. Turned on with GOOGLE_VISION_ENABLED=1 once the Vision API
// is enabled on that Google Cloud project.
//
// Rules (docs/plans/player-profiles.md §7.1):
//   adult / violence / racy LIKELY or VERY_LIKELY → rejected (hidden, admin alerted)
//   any of them POSSIBLE                           → needs_review (held for an admin)
//   otherwise                                      → approved (joins the Gallery)
// If the check can't run, the photo waits for an admin: nothing unchecked is
// ever published automatically.

export type ModerationResult = {
  status: PhotoStatus;
  safesearch: Record<string, string> | null;
  reason: "checked" | "not_configured" | "error";
  /** What went wrong, in Google's words (no secrets), when reason is "error". */
  detail?: string;
};

let client: JWT | null = null;

function visionClient(): JWT | null {
  if (process.env.GOOGLE_VISION_ENABLED !== "1") return null;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) return null;
  if (!client) {
    client = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-vision"] });
  }
  return client;
}

async function fetchImage(url: string): Promise<Buffer> {
  // A just-uploaded Blob can take a moment to reach the CDN: try a few times.
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const img = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const type = img.headers.get("content-type") ?? "";
      if (img.ok && type.startsWith("image/")) return Buffer.from(await img.arrayBuffer());
      last = `image fetch ${img.status} ${type}`;
    } catch (err) {
      last = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  throw new Error(last || "image fetch failed");
}

/** Checks image bytes with SafeSearch. */
export async function moderateBytes(bytes: Buffer): Promise<ModerationResult> {
  const vision = visionClient();
  if (!vision) return { status: "needs_review", safesearch: null, reason: "not_configured" };
  try {
    const res = await vision.request<{ responses: { safeSearchAnnotation?: Record<string, string>; error?: { message: string } }[] }>({
      url: "https://vision.googleapis.com/v1/images:annotate",
      method: "POST",
      data: { requests: [{ image: { content: bytes.toString("base64") }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }] },
    });
    const first = res.data.responses?.[0];
    if (!first?.safeSearchAnnotation) throw new Error(first?.error?.message ?? "no annotation");
    const ann = first.safeSearchAnnotation;
    return { status: decide(ann), safesearch: ann, reason: "checked" };
  } catch (err) {
    return failed(err);
  }
}

function failed(err: unknown): ModerationResult {
  const e = err as { message?: string; response?: { data?: { error?: { message?: string } } } };
  const detail = e.response?.data?.error?.message ?? e.message ?? String(err);
  console.error("[photos] SafeSearch failed:", detail);
  return { status: "needs_review", safesearch: null, reason: "error", detail };
}

/**
 * Checks one uploaded photo (public URLs). Sends the bytes rather than the
 * URL, so Google never needs to fetch from us. Tries the display copy, then
 * the original if Google can't read the display copy.
 */
export async function moderateImage(...urls: string[]): Promise<ModerationResult> {
  if (!visionClient()) return { status: "needs_review", safesearch: null, reason: "not_configured" };
  let result: ModerationResult | null = null;
  for (const url of urls) {
    try {
      result = await moderateBytes(await fetchImage(url));
    } catch (err) {
      result = failed(err);
    }
    if (result.reason === "checked") return result;
  }
  return result ?? { status: "needs_review", safesearch: null, reason: "error", detail: "no image" };
}

/** A small JPEG for the health check (proves the key, the API and billing). */
export const TEST_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnqKKK+xPjAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z", "base64");
