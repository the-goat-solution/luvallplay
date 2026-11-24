import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured } from "@/lib/db";
import { allowRate, parseSubmission, rateBucket, saveSubmission, verifyTurnstile } from "@/lib/forms";
import { isLang } from "@/lib/types";

export const runtime = "nodejs";

// A plain HTML form posts here and is redirected to a result page, so every
// form works without JavaScript.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const localeField = form.get("locale");
  const lang = typeof localeField === "string" && isLang(localeField) ? localeField : "en";
  const to = (status: string) => NextResponse.redirect(new URL(`/${lang}/thanks?status=${status}`, req.url), 303);

  const parsed = parseSubmission(form);
  // A bot that fills the honeypot is told all is well, and nothing is stored.
  if (!parsed.ok) return to(parsed.reason === "spam" ? "pending" : "error");
  if (!dbConfigured()) return to("error");

  const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  try {
    if (!(await allowRate(rateBucket(ip)))) return to("rate");
    const turnstile = form.get("cf-turnstile-response");
    if (!(await verifyTurnstile(typeof turnstile === "string" ? turnstile : null, ip))) return to("error");
    const saved = await saveSubmission(parsed.value);
    if (saved.mail === "failed") return to("error");
    return to(saved.status === "already-confirmed" ? "confirmed" : saved.mail === "captured" ? "pending-preview" : "pending");
  } catch (err) {
    console.error("[forms] submit failed", err);
    return to("error");
  }
}
