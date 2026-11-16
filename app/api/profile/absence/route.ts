import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { getClubToday } from "@/lib/dates";
import { setAbsence } from "@/lib/stats-db";
import { getCurrentMembership } from "@/lib/membership-self-service";
import { notifyWaitlistIfSpotOpened } from "@/lib/waitlist-notify";

const bodySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), absent: z.boolean() });

// "Can't make it": a member gives up one play day. They drop off that day's
// headcount and roster, so the spot opens for a casual player (and the
// waitlist hears about it). Their attendance streak isn't broken.
export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (body.date < getClubToday().dateKey) return NextResponse.json({ error: "past" }, { status: 400 });
  const m = await getCurrentMembership(player.email);
  if (!m) return NextResponse.json({ error: "no_membership" }, { status: 404 });
  await setAbsence(body.date, player.email, body.absent);
  if (body.absent) await notifyWaitlistIfSpotOpened(body.date).catch(() => 0);
  return NextResponse.json({ ok: true });
}
