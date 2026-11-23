import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { setLeaderboardVisible } from "@/lib/player-db";

const bodySchema = z.object({ leaderboardVisible: z.boolean() });

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setLeaderboardVisible(player.id, body.leaderboardVisible);
  revalidateTag("leaderboard", { expire: 0 });
  return NextResponse.json({ ok: true });
}
