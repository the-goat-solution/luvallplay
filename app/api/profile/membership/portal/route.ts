import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { cardUpdatePortalUrl } from "@/lib/membership-self-service";
import { getSiteUrl } from "@/lib/email-layout";

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  try {
    const url = await cardUpdatePortalUrl(player, `${getSiteUrl()}/profile?card=updated`);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[membership] portal failed:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
