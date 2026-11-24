import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { CONTENT_TAG } from "@/lib/content";

export const runtime = "nodejs";

// Sanity's publish webhook. The body is signed with SANITY_WEBHOOK_SECRET
// (header `sanity-webhook-signature: t=<ms>,v1=<base64url hmac>`), the same
// scheme as @sanity/webhook.
export function validSignature(body: string, header: string | null, secret: string, now = Date.now()): boolean {
  const m = /t=(\d+),v1=([A-Za-z0-9_-]+)/.exec(header ?? "");
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${m[1]}.${body}`).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(m[2]);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_WEBHOOK_SECRET;
  const body = await req.text();
  if (!secret || !validSignature(body, req.headers.get("sanity-webhook-signature"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  revalidateTag(CONTENT_TAG, { expire: 0 });
  return NextResponse.json({ revalidated: true });
}
