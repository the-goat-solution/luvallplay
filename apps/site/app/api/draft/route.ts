import { draftMode } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

// Draft preview for editors: /api/draft?secret=…&path=/en/pricing shows
// unpublished changes; /api/draft?off=1 leaves preview.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const path = p.get("path") || "/en";
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/en";
  const dm = await draftMode();
  if (p.get("off")) {
    dm.disable();
    return NextResponse.redirect(new URL(safe, req.url));
  }
  const secret = process.env.SANITY_PREVIEW_SECRET;
  if (!secret || p.get("secret") !== secret) return new NextResponse("Invalid secret", { status: 401 });
  dm.enable();
  return NextResponse.redirect(new URL(safe, req.url));
}
