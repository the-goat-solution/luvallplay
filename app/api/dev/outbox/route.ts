import { NextResponse } from "next/server";
import { capturedOutbox, clearCapturedOutbox, isProductionDeployment } from "@/lib/side-effects";

// Captured emails, for end-to-end tests: Playwright reads sign-in codes here.
// Served only when E2E_OUTBOX=1 and never on the production deployment, where
// email really sends and nothing is captured.

export const dynamic = "force-dynamic";

function enabled(): boolean {
  return process.env.E2E_OUTBOX === "1" && !isProductionDeployment();
}

export async function GET(request: Request) {
  if (!enabled()) return new NextResponse("Not found", { status: 404 });
  const to = new URL(request.url).searchParams.get("to")?.trim().toLowerCase();
  const mail = capturedOutbox().filter((m) => !to || m.to.some((t) => t.toLowerCase() === to));
  return NextResponse.json({ mail }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  if (!enabled()) return new NextResponse("Not found", { status: 404 });
  clearCapturedOutbox();
  return NextResponse.json({ ok: true });
}
