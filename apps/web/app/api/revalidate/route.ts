import { revalidatePath, revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { SIGNATURE_HEADER_NAME, isValidSignature } from "@sanity/webhook";
import { SANITY_CACHE_TAG } from "@/lib/sanity";

function purgeHome() {
  revalidatePath("/");
  revalidateTag(SANITY_CACHE_TAG, { expire: 0 });
}

export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { message: "Missing SANITY_REVALIDATE_SECRET" },
      { status: 500 },
    );
  }

  // Manual trigger: POST /api/revalidate?secret=...
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (querySecret === secret) {
    purgeHome();
    return NextResponse.json({ revalidated: true, source: "query" });
  }

  try {
    // Sanity signs the raw body (header "sanity-webhook-signature").
    const raw = await req.text();
    const signature = req.headers.get(SIGNATURE_HEADER_NAME) ?? "";
    if (!signature || !(await isValidSignature(raw, signature, secret))) {
      return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
    }
    const body = (raw ? JSON.parse(raw) : null) as { _type?: string } | null;

    purgeHome();
    return NextResponse.json({
      revalidated: true,
      source: "webhook",
      documentType: body?._type ?? null,
    });
  } catch (err) {
    console.error("[revalidate] webhook error:", err);
    return NextResponse.json({ message: "Revalidation failed" }, { status: 500 });
  }
}
