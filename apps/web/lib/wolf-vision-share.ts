import { CLUB_TIME_ZONE } from "@/lib/constants";
import { z } from "zod";
import { getResend } from "@/lib/email";
import { getSiteUrl, withDisplayName } from "@/lib/email-layout";
import { renderStatsEmail } from "@/lib/wolf-vision-email";
import { isTrial } from "@/lib/wolf-vision-trial";
import { rateLimit } from "@/lib/security";

// After a tracker session that isn't an Arena challenge: the match stats by
// email to the players who were added by email because they aren't
// registered. Numbers and names only; at most 3 recipients a match. Used by
// the website's /api/wolf-vision/share and the players' app.

const name = z.string().trim().min(1).max(60);
export const shareSchema = z.object({
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

const DAY_MS = 24 * 3_600_000;
/** Matches one person can share by email in a day. */
export const SHARES_PER_SENDER_PER_DAY = 12;
/** Stats emails one address can get in a day, from all senders together. */
export const EMAILS_PER_ADDRESS_PER_DAY = 6;

type Sender = { id: number; email: string; firstName: string; lastName: string };

/** Sends the emails; `allow` is the sender's limit, asked only when there is someone to email. */
export async function shareStats(
  sender: Sender,
  body: z.infer<typeof shareSchema>,
  allow: () => boolean,
): Promise<{ status: number; json: { ok: boolean; sent: string[]; failed?: string[] } | { error: string } }> {
  const recipients = body.players.map((p, i) => ({ ...p, i })).filter((p) => p.email && p.email !== sender.email);
  const unique = [...new Map(recipients.map((r) => [r.email, r])).values()];
  if (!unique.length) return { status: 200, json: { ok: true, sent: [] } };
  if (unique.length > 3) return { status: 400, json: { error: "too_many_recipients" } };
  if (!allow()) return { status: 429, json: { error: "too_many" } };
  // The limits that hold whoever calls this (the website's route, the app's
  // API) and on every server instance when the shared store is on
  // (lib/security.ts): a sender shares a few matches a day, and one address
  // gets a few of these emails a day from everyone together, so the club's
  // name can't be used to send someone a stream of mail (audit: "any account
  // can send club-branded stats emails to any address").
  if (!(await rateLimit(`wv-share:sender:${sender.id}`, SHARES_PER_SENDER_PER_DAY, DAY_MS))) return { status: 429, json: { error: "too_many" } };
  const within = await Promise.all(unique.map((r) => rateLimit(`wv-share:to:${r.email}`, EMAILS_PER_ADDRESS_PER_DAY, DAY_MS)));
  if (within.some((ok) => !ok)) return { status: 429, json: { error: "too_many" } };
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { status: 503, json: { error: "email_off" } };

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
  return { status: failed.length && !sent.length ? 502 : 200, json: { ok: failed.length === 0, sent, failed } };
}
