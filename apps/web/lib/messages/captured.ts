// Push notifications and texts that would have gone out, outside production
// (lib/side-effects.ts: side effects only happen on the production
// deployment). Kept in memory for tests and previews to look at.
import type { ChannelId } from "./dispatch";

export type CapturedSend = { channel: ChannelId; memberId: number; to: string; text: string; at: string };

const KEY = Symbol.for("lvp.captured-channel-sends");
type G = typeof globalThis & { [KEY]?: CapturedSend[] };

export function capturedChannelSends(): CapturedSend[] {
  const g = globalThis as G;
  if (!g[KEY]) g[KEY] = [];
  return g[KEY];
}

export function captureChannelSend(send: Omit<CapturedSend, "at">): void {
  const list = capturedChannelSends();
  list.push({ ...send, at: new Date().toISOString() });
  if (list.length > 200) list.splice(0, list.length - 200);
}

export function clearCapturedChannelSends(): void {
  capturedChannelSends().length = 0;
}
