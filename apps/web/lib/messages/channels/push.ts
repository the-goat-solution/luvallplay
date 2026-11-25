// The push channel. The app's push registration (FCM) belongs to the native
// app lane; until it registers a sender here, this channel is "unavailable"
// and announcements go out on the member's other channels.
//
// Outside production nothing is pushed: the notification is captured
// (lib/side-effects.ts), like email.
import { sideEffectAllowed } from "../../side-effects";
import type { Announcement, MessageChannel, Recipient, SendResult } from "../dispatch";
import { captureChannelSend } from "../captured";

export type PushNotification = { tokens: readonly string[]; title: string; body: string; path?: string };
export type PushSender = (notification: PushNotification) => Promise<SendResult>;

/** A lock-screen line: short, and never the whole message (it can be read by anyone holding the phone). */
export function pushBody(a: Announcement): string {
  const text = a.subject.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function pushChannel(options: { sender?: PushSender | null; allowed?: () => boolean } = {}): MessageChannel {
  const sender = options.sender ?? null;
  const allowed = options.allowed ?? (() => sideEffectAllowed("push"));
  return {
    id: "push",
    available: () => sender !== null,
    canReach: (r: Recipient) => (r.pushTokens?.length ?? 0) > 0,
    async send(a: Announcement, r: Recipient) {
      const notification: PushNotification = { tokens: r.pushTokens ?? [], title: a.clubName, body: pushBody(a), path: a.path };
      if (!allowed()) {
        captureChannelSend({ channel: "push", memberId: r.memberId, to: `${notification.tokens.length} device(s)`, text: `${notification.title}: ${notification.body}` });
        return { ok: true as const, providerId: "captured" };
      }
      return sender!(notification);
    },
  };
}
