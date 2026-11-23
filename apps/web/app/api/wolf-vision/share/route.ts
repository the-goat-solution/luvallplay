import { CLUB_TIME_ZONE } from "@/lib/constants";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { checkRateLimit } from "@/lib/security";
import { getResend } from "@/lib/email";
import { getSiteUrl, withDisplayName } from "@/lib/email-layout";
import { renderStatsEmail } from "@/lib/wolf-vision-email";
import { isTrial } from "@/lib/wolf-vision-trial";

// After a free Wolf Vision session (not an Arena challenge): emails the match
// stats to the players who were added by email because they aren't
// registered. Numbers and names only; at most 3 recipients a match, and a
// limit per sender, so this can't be used to send anything else.

export const dynamic = "force-dynamic";

const name = z.string().trim().min(1).max(60);
const bodySchema = z.object({
  teams: z.tuple([name, name]),
  duration: z.number().min(0).max(4 * 3600),
  rallies: z.number().int().min(0).max(2000),
  longestRally: z.number().int().min(0).max(1000),
  avgRallyShots: z.number().min(0).max(1000),
  fastestShotKmh: z.number().min(0).max(500).nullable(),
  players: z
    .array(
      z.object({
        name,
        team: z.union([z.literal(0), z.literal(1)]),
        hits: z.number().int().min(0).max(5000),
        distance: z.number().min(0).max(50_000),
        topSpeed: z.number().min(0).max(15),
        email: z.string().trim().toLowerCase().email().max(200).optional(),
      }),
    )
    .length(4),
});

function playedAt(): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: CLUB_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

export async function POST(request: Request) {
  const sender = await getPlayerFromRequest(request);
  if (!sender) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const body = parsed.data;
  const recipients = body.players.map((p, i) => ({ ...p, i })).filter((p) => p.email && p.email !== sender.email);
  const unique = [...new Map(recipients.map((r) => [r.email, r])).values()];
  if (!unique.length) return NextResponse.json({ ok: true, sent: [] });
  if (unique.length > 3) return NextResponse.json({ error: "too_many_recipients" }, { status: 400 });
  if (!checkRateLimit(`wv-share:${sender.id}`, 12, 24 * 3_600_000)) return NextResponse.json({ error: "too_many" }, { status: 429 });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return NextResponse.json({ error: "email_off" }, { status: 503 });

  const recordedBy = `${sender.firstName} ${sender.lastName}`.trim() || "A Three Wolves player";
  const when = playedAt();
  const sent: string[] = [];
  const failed: string[] = [];
  for (const r of unique) {
    const email = renderStatsEmail({
      siteUrl: getSiteUrl(),
      recipientName: r.name,
      recipientIndex: r.i,
      recordedBy,
      playedAt: when,
      teams: body.teams,
      duration: body.duration,
      rallies: body.rallies,
      longestRally: body.longestRally,
      avgRallyShots: body.avgRallyShots,
      fastestShotKmh: body.fastestShotKmh,
      players: body.players.map(({ name, team, hits, distance, topSpeed }) => ({ name, team, hits, distance, topSpeed })),
      freeUntil: isTrial() ? "28 February 2027" : null,
    });
    try {
      await getResend().emails.send({
        from: withDisplayName(process.env.EMAIL_FROM),
        to: r.email!,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      sent.push(r.email!);
    } catch (err) {
      console.error("[wolf-vision] stats email failed", err);
      failed.push(r.email!);
    }
  }
  return NextResponse.json({ ok: failed.length === 0, sent, failed }, { status: failed.length && !sent.length ? 502 : 200 });
}
