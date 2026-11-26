// The SMS channel. Texts cost money per message, so:
//   - it is "unavailable" until a deployment registers a sender (today's SMS
//     code only sends sign-in codes through Google, lib/sms.ts, and stays as
//     it is);
//   - a text is one segment: the club, the subject and a link, never the body;
//   - only mobile numbers of the countries the deployment allows are texted.
//
// Outside production nothing is texted: the message is captured.
import { sideEffectAllowed } from "../../side-effects";
import type { Announcement, MessageChannel, Recipient, SendResult } from "../dispatch";
import { captureChannelSend } from "../captured";

export type SmsSender = (message: { to: string; text: string }) => Promise<SendResult>;

/** One GSM segment is 160 characters; with any accented letter the limit is 70. */
export const SMS_PLAIN_MAX = 160;
export const SMS_UNICODE_MAX = 70;
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;

/** The text of an announcement: "Club: subject link", cut to one segment. The link is kept whole. */
export function smsText(a: Announcement, link?: string): string {
  const tail = link ? ` ${link}` : "";
  const head = `${a.clubName}: ${a.subject}`.replace(/\s+/g, " ").trim();
  const max = GSM.test(head + tail) ? SMS_PLAIN_MAX : SMS_UNICODE_MAX;
  const room = max - tail.length;
  if (room <= 0) return (head + tail).slice(0, max);
  return (head.length > room ? `${head.slice(0, Math.max(0, room - 1))}…` : head) + tail;
}

export function smsChannel(options: { sender?: SmsSender | null; isAllowedNumber?: (e164: string) => boolean; link?: (a: Announcement) => string | undefined; allowed?: () => boolean } = {}): MessageChannel {
  const sender = options.sender ?? null;
  const isAllowedNumber = options.isAllowedNumber ?? (() => false);
  const allowed = options.allowed ?? (() => sideEffectAllowed("sms"));
  return {
    id: "sms",
    available: () => sender !== null,
    canReach: (r: Recipient) => Boolean(r.phoneE164 && isAllowedNumber(r.phoneE164)),
    async send(a: Announcement, r: Recipient) {
      const text = smsText(a, options.link?.(a));
      if (!allowed()) {
        captureChannelSend({ channel: "sms", memberId: r.memberId, to: r.phoneE164!, text });
        return { ok: true as const, providerId: "captured" };
      }
      return sender!({ to: r.phoneE164!, text });
    },
  };
}
