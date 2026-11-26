// Message channels (build plan §11.4, decision AD: "the Messages module gets
// channels (email, push, SMS and Zalo), so a club's announcement goes out on
// the channels each member chose"; Track V).
//
// This file is the rules, with no I/O: who gets an announcement on which
// channel, and what happened. The channels themselves (./channels/*) do the
// sending and are passed in, so the rules are tested without sending
// anything.
//
// The rules:
//   - A member who chose channels gets the announcement on exactly those.
//   - A member who chose none ("don't message me") gets nothing.
//   - A member who hasn't chosen gets the club's default channels (email).
//   - A channel that can't reach the member (no phone number, no device) or
//     isn't switched on for this deployment is recorded, not an error. If
//     none of a member's channels could even be tried, email is tried once
//     as a fallback, unless they chose none.
//   - One channel failing never stops the others, or the next member.
//   - The same announcement is never sent twice to the same member on the
//     same channel, however many times the send is run (the caller passes
//     what was already delivered).

export const CHANNEL_IDS = ["email", "push", "sms", "zalo"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export const isChannelId = (v: unknown): v is ChannelId => typeof v === "string" && (CHANNEL_IDS as readonly string[]).includes(v);

/** What every club sends on when a member hasn't chosen. */
export const DEFAULT_CHANNELS: readonly ChannelId[] = ["email"];

export type Announcement = {
  /** Stable id: with the member and the channel, the key for "already sent". */
  id: string;
  clubName: string;
  subject: string;
  body: string;
  /** A path in the app to open ("/inbox/12"). */
  path?: string;
};

export type Recipient = {
  memberId: number;
  name: string;
  /** "en", "vi". */
  lang: string;
  /** null or undefined: hasn't chosen. []: chose none. */
  channels?: readonly ChannelId[] | null;
  email?: string | null;
  phoneE164?: string | null;
  pushTokens?: readonly string[];
  zaloUserId?: string | null;
};

export type SendResult = { ok: true; providerId?: string } | { ok: false; reason: string };

export interface MessageChannel {
  readonly id: ChannelId;
  /** Whether this deployment can use the channel at all (configured, and allowed for its region). */
  available(): boolean;
  /** Whether this member can be reached on it (has an address, a number, a device). */
  canReach(recipient: Recipient): boolean;
  send(announcement: Announcement, recipient: Recipient): Promise<SendResult>;
}

export type DeliveryStatus =
  | "sent"
  | "failed"
  /** The member has no address, number or device for this channel. */
  | "unreachable"
  /** The channel isn't set up or allowed for this deployment. */
  | "unavailable"
  /** Delivered by an earlier run. */
  | "already_sent";

export type Delivery = { memberId: number; channel: ChannelId; status: DeliveryStatus; fallback: boolean; reason?: string; providerId?: string };

export type AnnouncementReport = {
  announcementId: string;
  deliveries: Delivery[];
  /** Members who got it on at least one channel (now or in an earlier run). */
  reached: number;
  /** Members who chose not to be messaged. */
  optedOut: number;
  /** Members no channel could reach. */
  missed: number[];
};

/** A member's stored choice → a clean list: known channels only, each once. Anything unreadable counts as "hasn't chosen". */
export function parseChannelChoice(raw: unknown): ChannelId[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter(isChannelId))];
}

/** The channels to try for a member, in the order CHANNEL_IDS lists them. */
export function channelsFor(recipient: Pick<Recipient, "channels">, clubDefault: readonly ChannelId[] = DEFAULT_CHANNELS): ChannelId[] {
  const chosen = recipient.channels ?? clubDefault;
  return CHANNEL_IDS.filter((id) => chosen.includes(id));
}

export const deliveryKey = (announcementId: string, memberId: number, channel: ChannelId) => `${announcementId}:${memberId}:${channel}`;

export type DispatchOptions = {
  channels: readonly MessageChannel[];
  clubDefault?: readonly ChannelId[];
  /** deliveryKey values already delivered, from earlier runs. */
  alreadySent?: ReadonlySet<string>;
};

/** Sends one announcement to the members, by the rules above. Never throws. */
export async function dispatchAnnouncement(announcement: Announcement, recipients: readonly Recipient[], options: DispatchOptions): Promise<AnnouncementReport> {
  const byId = new Map(options.channels.map((c) => [c.id, c]));
  const done = new Set(options.alreadySent ?? []);
  const deliveries: Delivery[] = [];
  const missed: number[] = [];
  let reached = 0;
  let optedOut = 0;
  const seenMembers = new Set<number>();

  const attempt = async (recipient: Recipient, id: ChannelId, fallback: boolean): Promise<Delivery> => {
    const base = { memberId: recipient.memberId, channel: id, fallback };
    const key = deliveryKey(announcement.id, recipient.memberId, id);
    if (done.has(key)) return { ...base, status: "already_sent" };
    const channel = byId.get(id);
    try {
      if (!channel || !channel.available()) return { ...base, status: "unavailable" };
      if (!channel.canReach(recipient)) return { ...base, status: "unreachable" };
      const result = await channel.send(announcement, recipient);
      if (!result.ok) return { ...base, status: "failed", reason: result.reason };
      done.add(key);
      return { ...base, status: "sent", providerId: result.providerId };
    } catch (err) {
      // A channel that throws is a failed delivery, never a failed announcement.
      return { ...base, status: "failed", reason: err instanceof Error ? err.message.slice(0, 200) : "error" };
    }
  };

  for (const recipient of recipients) {
    // The same member listed twice gets one copy.
    if (seenMembers.has(recipient.memberId)) continue;
    seenMembers.add(recipient.memberId);

    const wanted = channelsFor(recipient, options.clubDefault);
    if (wanted.length === 0) {
      optedOut++;
      continue;
    }
    const mine: Delivery[] = [];
    for (const id of wanted) mine.push(await attempt(recipient, id, false));
    const tried = mine.some((d) => d.status === "sent" || d.status === "failed" || d.status === "already_sent");
    if (!tried && !wanted.includes("email")) mine.push(await attempt(recipient, "email", true));
    deliveries.push(...mine);
    if (mine.some((d) => d.status === "sent" || d.status === "already_sent")) reached++;
    else missed.push(recipient.memberId);
  }
  return { announcementId: announcement.id, deliveries, reached, optedOut, missed };
}
