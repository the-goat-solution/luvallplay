// Message channels for the Messages module (build plan §11.4, decision AD).
//
// Switched OFF by default: with MESSAGE_CHANNELS unset, sendAnnouncement
// sends nothing and says so. Nothing in the app calls it yet, and the
// existing message emails (lib/message-notify.ts) are untouched, so Three
// Wolves' messaging is exactly as before.
//
// Channels today:
//   email  the club's existing notice email.
//   push   Firebase Cloud Messaging, when FCM_SERVICE_ACCOUNT is set
//          (lib/push/fcm.ts); otherwise unavailable.
//   sms    waits for a deployment to register a text sender; never the
//          sign-in SMS allowance.
//   zalo   named, not built: it waits for Zalo's rules in writing (§11.4).
import { emailChannel } from "./channels/email";
import { pushChannel, type PushSender } from "./channels/push";
import { fcmPushSender } from "../push/fcm";
import { smsChannel, type SmsSender } from "./channels/sms";
import { dispatchAnnouncement, type Announcement, type AnnouncementReport, type ChannelId, type MessageChannel, type Recipient } from "./dispatch";

export * from "./dispatch";
export { capturedChannelSends, clearCapturedChannelSends } from "./captured";

type Env = Record<string, string | undefined>;

/** The switch. On only when MESSAGE_CHANNELS is exactly "on". */
export function messageChannelsOn(env: Env = process.env): boolean {
  return env.MESSAGE_CHANNELS?.trim().toLowerCase() === "on";
}

let pushSender: PushSender | null = null;
let smsSender: { send: SmsSender; isAllowedNumber: (e164: string) => boolean } | null = null;

/**
 * The deployment's own push sender: Firebase, when FCM_SERVICE_ACCOUNT is set
 * (lib/push/fcm.ts), else null and the push channel is "unavailable".
 * Addresses Firebase says are gone are deleted as it goes; the database is
 * only loaded when that happens.
 */
function deploymentPushSender(env: Env = process.env): PushSender | null {
  return fcmPushSender(env, { onGone: async (tokens) => (await import("../app-push")).forgetGoneAddresses(tokens) });
}

/** For the lane that owns push: plug the sender in (null removes it). */
export function registerPushSender(sender: PushSender | null): void {
  pushSender = sender;
}

/** For a deployment with a text provider: the sender, and which numbers it may text. */
export function registerSmsSender(sender: { send: SmsSender; isAllowedNumber: (e164: string) => boolean } | null): void {
  smsSender = sender;
}

/** The channels this deployment has, built fresh so a newly registered sender is seen. */
export function deploymentChannels(): MessageChannel[] {
  return [emailChannel(), pushChannel({ sender: pushSender ?? deploymentPushSender() }), smsChannel({ sender: smsSender?.send ?? null, isAllowedNumber: smsSender?.isAllowedNumber })];
}

export type SendOptions = { clubDefault?: readonly ChannelId[]; alreadySent?: ReadonlySet<string>; channels?: readonly MessageChannel[]; env?: Env };

/**
 * Sends a club's announcement on each member's chosen channels. With the
 * switch off it sends nothing and returns `off: true`. Never throws.
 */
export async function sendAnnouncement(announcement: Announcement, recipients: readonly Recipient[], options: SendOptions = {}): Promise<AnnouncementReport & { off: boolean }> {
  if (!messageChannelsOn(options.env)) return { announcementId: announcement.id, deliveries: [], reached: 0, optedOut: 0, missed: [], off: true };
  const report = await dispatchAnnouncement(announcement, recipients, { channels: options.channels ?? deploymentChannels(), clubDefault: options.clubDefault, alreadySent: options.alreadySent });
  return { ...report, off: false };
}
