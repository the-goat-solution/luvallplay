import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { shareSchema, shareStats } from "@/lib/wolf-vision-share";

// After a free Wolf Vision session (not an Arena challenge): emails the match
// stats to the players who were added by email because they aren't
// registered (lib/wolf-vision-share.ts). A limit per sender, so this can't be
// used to send anything else.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sender = await getPlayerFromRequest(request);
  if (!sender) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const parsed = shareSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const r = await shareStats(sender, parsed.data, () => checkRateLimit(`wv-share:${sender.id}`, 12, 24 * 3_600_000));
  return NextResponse.json(r.json, { status: r.status });
}
