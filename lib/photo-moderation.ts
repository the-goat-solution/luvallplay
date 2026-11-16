import { JWT } from "google-auth-library";
import type { PhotoStatus } from "./photos-db";

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

const LIKELIHOOD = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"] as const;
type Likelihood = (typeof LIKELIHOOD)[number];

export type ModerationResult = {
  status: PhotoStatus;
  safesearch: Record<string, string> | null;
  reason: "checked" | "not_configured" | "error";
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

function level(v: string | undefined): number {
  const i = LIKELIHOOD.indexOf((v ?? "UNKNOWN") as Likelihood);
  return i === -1 ? 0 : i;
}

export function decide(annotation: Record<string, string>): PhotoStatus {
  const watched = ["adult", "violence", "racy"].map((k) => level(annotation[k]));
  if (watched.some((l) => l >= level("LIKELY"))) return "rejected";
  if (watched.some((l) => l >= level("POSSIBLE"))) return "needs_review";
  return "approved";
}

/** Checks one image (the display copy, a public URL). */
export async function moderateImage(imageUrl: string): Promise<ModerationResult> {
  const vision = visionClient();
  if (!vision) return { status: "needs_review", safesearch: null, reason: "not_configured" };
  try {
    // Send the bytes rather than the URL, so Google never needs to fetch from us.
    const img = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!img.ok) throw new Error(`image fetch ${img.status}`);
    const content = Buffer.from(await img.arrayBuffer()).toString("base64");
    const res = await vision.request<{ responses: { safeSearchAnnotation?: Record<string, string>; error?: { message: string } }[] }>({
      url: "https://vision.googleapis.com/v1/images:annotate",
      method: "POST",
      data: { requests: [{ image: { content }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }] },
    });
    const first = res.data.responses?.[0];
    if (!first?.safeSearchAnnotation) throw new Error(first?.error?.message ?? "no annotation");
    const ann = first.safeSearchAnnotation;
    return { status: decide(ann), safesearch: ann, reason: "checked" };
  } catch (err) {
    console.error("[photos] SafeSearch failed:", err);
    return { status: "needs_review", safesearch: null, reason: "error" };
  }
}
