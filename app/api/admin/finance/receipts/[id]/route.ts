import { NextResponse } from "next/server";
import { ensureFinanceTables, getEntryReceipt } from "@/lib/finance-db";
import { fetchReceipt } from "@/lib/finance-receipts";
import { isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

// Streams a finance entry's receipt to a logged-in admin. Receipts are
// private blobs (see lib/finance-receipts.ts), so this route is the only way
// to view one — the storage URL itself is never sent to the browser.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await ensureFinanceTables();
  const receipt = await getEntryReceipt(id);
  if (!receipt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await fetchReceipt(receipt.url, receipt.access).catch((err) => {
    console.error("Failed to fetch receipt", id, err);
    return null;
  });
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "Receipt file is missing" }, { status: 404 });
  }

  const contentType = result.blob.contentType || receipt.contentType || "application/octet-stream";
  const download = new URL(request.url).searchParams.has("download");
  return new Response(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(result.blob.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="receipt-${id}${extensionFor(contentType)}"`,
      // Private to this admin's browser; never stored by a shared cache.
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function extensionFor(contentType: string): string {
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/heic" || contentType === "image/heif") return ".heic";
  return ".jpg";
}
