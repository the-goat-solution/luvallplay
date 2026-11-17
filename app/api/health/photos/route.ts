import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/security";
import { moderateImage } from "@/lib/photo-moderation";

// Photo safety check (Google SafeSearch): runs the real check on a small
// test image and reports what Google said. Open on previews; admins only in
// production. Never shows keys.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production" && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: "admins_only" }, { status: 401 });
  }
  const origin = new URL(request.url).origin;
  const result = await moderateImage(`${origin}/icon.png`);
  return NextResponse.json(
    {
      enabled: process.env.GOOGLE_VISION_ENABLED === "1",
      serviceAccountEmail: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      serviceAccountKey: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      ...result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
