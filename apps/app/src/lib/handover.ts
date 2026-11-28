// The app's side of the cutover's session handover (phase-4-cutover.md §4.1,
// gap B2). The website sends a signed-in member to
// `/handover#t=<token>&to=<screen>`: the part after `#` never reaches a server
// or a referrer. The token is swapped once for an app session; it never
// replaces a session the app already has.
import { appNext, HOME } from "./next-path.ts";

export type HandoverLink = { token: string | null; to: string };

/** The token and the screen from the address's fragment (with or without its `#`). */
export function parseHandover(hash: string): HandoverLink {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("t");
  return { token: token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null, to: appNext(params.get("to") ?? HOME) };
}

export type HandoverStep =
  | { kind: "open"; to: string } // already signed in: the token is ignored
  | { kind: "swap"; token: string; to: string }
  | { kind: "signin"; to: string }; // no usable token

/** What to do with a handover link, given whether the app already has a session. */
export function handoverStep(link: HandoverLink, signedIn: boolean): HandoverStep {
  if (signedIn) return { kind: "open", to: link.to };
  if (!link.token) return { kind: "signin", to: link.to };
  return { kind: "swap", token: link.token, to: link.to };
}

/** The sign-in address that opens `to` afterwards. */
export const signInFor = (to: string): string => (to === HOME ? "/signin" : `/signin?next=${encodeURIComponent(to)}`);
