import { NextResponse, type NextRequest } from "next/server";
import { confirmSubmission } from "@/lib/forms";

export const runtime = "nodejs";

// The link in the email. A GET shows a page with a button; only the button's
// POST changes anything, so mail scanners that open links can't trigger it.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const lang = req.nextUrl.searchParams.get("l") === "vi" ? "vi" : "en";
  return NextResponse.redirect(new URL(`/${lang}/thanks?status=confirm&t=${encodeURIComponent(token)}`, req.url), 303);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = form.get("t");
  let lang: string | null = null;
  try {
    lang = typeof token === "string" && token ? await confirmSubmission(token) : null;
  } catch (err) {
    console.error("[forms] confirm failed", err);
  }
  const fallback = form.get("locale") === "vi" ? "vi" : "en";
  return NextResponse.redirect(new URL(`/${lang ?? fallback}/thanks?status=${lang ? "confirmed" : "invalid"}`, req.url), 303);
}
