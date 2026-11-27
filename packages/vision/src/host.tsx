// What the tracker needs from the app that shows it (the website or the
// players' app): the language, the club's words, links, a way to take the
// whole screen, and its server. The server calls are named, not URLs: each
// app maps them to its own routes, which answer with the same JSON and
// status codes, so the tracker reads every answer the same way.
import type { OverlayTheme } from "./ui/overlay.ts";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import type { ClubWords, Lang } from "./words.ts";

export type { ClubWords, Lang } from "./words.ts";
export type { OverlayTheme } from "./ui/overlay.ts";
export { PLAIN_WORDS, fillWords } from "./words.ts";

/** The tracker's server calls. */
export type VisionEndpoint =
  /** GET ?challenge=ID → { setup, stats } */
  | "challenge"
  /** GET ?kind[&session_id] → the pass or the trial; POST { kind, challengeId?, returnTo? } → { url } | { pass, testMode }; PATCH { passId } → { pass } */
  | "pass"
  /** POST the final stats → { ok, stats }; PUT a heartbeat → { ok } */
  | "stats"
  /** GET the shared checker weights → { model }; POST a session's weights → { ok } */
  | "model"
  /** POST stats to email to unregistered players → { ok, sent, failed } */
  | "share"
  /** GET → { players: [{ id, name, avatarUrl, me }] } */
  | "players"
  /** POST hits marked by hand → { ok, id } */
  | "labels";

export type VisionRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  query?: Record<string, string>;
  body?: unknown;
  /** Lets the request outlive the page (sent as the tracker closes). */
  keepalive?: boolean;
};
export type VisionTransport = (endpoint: VisionEndpoint, request?: VisionRequest) => Promise<Response>;

export type VisionHost = {
  lang: Lang;
  /** Offers a language switch when set. */
  setLang?: (lang: Lang) => void;
  /** Fills the club's own words ({visionName}) into a copy object for this language. */
  termed: <T>(copy: T, lang: Lang) => T;
  /** The club's name for the tracker. */
  visionName: string;
  /** The club's words for a player and a pair (default: plain ones). */
  words?: Partial<Record<Lang, ClubWords>>;
  /** A live match's and a video's price after the trial, in the club's money ("NZ$5"). */
  prices: { live: string; upload: string };
  /**
   * Whether this host sells passes. Default true. The Android store app sets it
   * false until Play Billing exists (Play's payments policy: digital purchases
   * inside the app must use it): no price, no "buy" button, only a note that
   * says where a pass can be bought.
   */
  purchases?: boolean;
  transport: VisionTransport;
  links: {
    /** Back to the Arena. */
    arena: string;
    /** The tracker itself (where a paid checkout returns). */
    tracker: string;
    /** The labelling tool. */
    label: string;
    /** Sign in, coming back to `next`. */
    signIn: (next: string) => string;
  };
  /** Asked to hide the app's own bars while a session is set up or running. */
  onFocus?: (on: boolean) => void;
  /**
   * The line drawn under the overlay's HUD (into recordings too) and a small
   * logo beside it. Same-origin logos only: another site's image would stop
   * the canvas from being recorded. Default: the tracker's name alone.
   */
  brand?: { line: string; logoUrl?: string | null };
  /** The overlay's colours and fonts (the club's); default: the night court's own. */
  overlay?: Partial<OverlayTheme>;
};

const Ctx = createContext<VisionHost | null>(null);

export function VisionHostProvider({ host, children }: { host: VisionHost; children: ReactNode }) {
  return <Ctx.Provider value={host}>{children}</Ctx.Provider>;
}

export function useVisionHost(): VisionHost {
  const h = useContext(Ctx);
  if (!h) throw new Error("The tracker needs a VisionHostProvider.");
  return h;
}

/** Asks the host to give the tracker the whole screen while `on`. */
export function useHostFocus(on: boolean): void {
  const { onFocus } = useVisionHost();
  useEffect(() => {
    if (!onFocus) return;
    onFocus(on);
    return () => onFocus(false);
  }, [onFocus, on]);
}

/**
 * A copy table with each string read through `fill` (the host's way of
 * putting in the club's words), for a host without its own helper.
 */
export function fillTerms<T>(table: T, fill: (text: string) => string): T {
  const one = (value: unknown): unknown => {
    if (typeof value === "string") return fill(value);
    if (Array.isArray(value)) return value.map(one);
    if (value && typeof value === "object") return fillTerms(value, fill);
    return value;
  };
  return new Proxy(table as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          return typeof out === "string" ? fill(out) : out;
        };
      }
      return one(value);
    },
  }) as T;
}

/** A fetch-shaped call to the host's server. */
export function useTransport(): VisionTransport {
  return useVisionHost().transport;
}
