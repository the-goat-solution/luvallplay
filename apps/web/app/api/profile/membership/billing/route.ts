import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { getBilling, getCurrentMembership } from "@/lib/membership-self-service";

// Card on file, next charge, a scheduled change and receipts. Loaded after
// the page so Stripe never slows the Membership tab down.
export async function GET(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  try {
    const m = await getCurrentMembership(player.email);
    return NextResponse.json(await getBilling(player, m), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[membership] billing failed:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
