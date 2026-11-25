// The email channel: the club's existing notice email (lib/player-email.ts),
// so an announcement by email looks like every other email a member gets.
// Outside production the email is captured, never sent (lib/side-effects.ts).
import { sendPlayerNoticeEmail } from "../../player-email";
import type { Announcement, MessageChannel, Recipient } from "../dispatch";

type Sender = (input: { to: string; subject: string; heading: string; lines: string[]; cta?: { label: string; path: string } }) => Promise<void>;

const OPEN: Record<string, string> = { en: "Open", vi: "Mở" };

export function emailChannel(options: { send?: Sender; configured?: () => boolean } = {}): MessageChannel {
  const send = options.send ?? sendPlayerNoticeEmail;
  const configured = options.configured ?? (() => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM));
  return {
    id: "email",
    available: configured,
    canReach: (r: Recipient) => Boolean(r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)),
    async send(a: Announcement, r: Recipient) {
      await send({
        to: r.email!,
        subject: `${a.clubName}: ${a.subject}`,
        heading: a.subject,
        lines: a.body.slice(0, 4000).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
        cta: a.path ? { label: OPEN[r.lang] ?? OPEN.en, path: a.path } : undefined,
      });
      return { ok: true as const };
    },
  };
}
