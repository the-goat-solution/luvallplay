"use client";

// The website's side of the tracker (packages/vision): its own /api routes,
// the language switch, the club's words, its links and the profile app's
// full-screen mode. The tracker itself lives in @luvallplay/vision, shared
// with the players' app.
import { useContext, useMemo, type ReactNode } from "react";
import { VisionHostProvider, type VisionEndpoint, type VisionHost, type VisionTransport } from "@luvallplay/vision/host";
import { termed, visionName } from "@/lib/club-terms";
import { useLanguage } from "@/context/LanguageContext";
import { ProfileFocusContext } from "@/components/profile/focus";

const PATHS: Record<VisionEndpoint, string> = {
  challenge: "/api/arena/match-stats",
  stats: "/api/arena/match-stats",
  pass: "/api/wolf-vision/pass",
  model: "/api/wolf-vision/model",
  share: "/api/wolf-vision/share",
  players: "/api/wolf-vision/players",
  labels: "/api/wolf-vision/labels",
};

export const webTransport: VisionTransport = (endpoint, { method = "GET", query, body, keepalive } = {}) => {
  const q = query ? `?${new URLSearchParams(query)}` : "";
  return fetch(`${PATHS[endpoint]}${q}`, {
    method,
    ...(method === "GET" ? { cache: "no-store" as const } : {}),
    ...(keepalive ? { keepalive } : {}),
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
};

// Three Wolves' own words for a player and a pair, as the tracker always said.
const WORDS: VisionHost["words"] = {
  en: { player: "wolf", players: "wolves", Player: "Wolf", Pair: "Pack" },
  vi: { player: "sói", players: "sói", Player: "Sói", Pair: "Bầy" },
};
// The pass prices after the trial (PASS_PRICE_CENTS in lib/wolf-vision-db.ts).
const PRICES: VisionHost["prices"] = { live: "NZ$5", upload: "NZ$2" };

const LINKS: VisionHost["links"] = {
  arena: "/profile/arena",
  tracker: "/profile/wolf-vision",
  label: "/profile/wolf-vision/label",
  signIn: (next) => `/login?next=${encodeURIComponent(next)}`,
};

export function WebVisionHost({ children }: { children: ReactNode }) {
  const { lang, setLang } = useLanguage();
  const onFocus = useContext(ProfileFocusContext) ?? undefined;
  const host = useMemo<VisionHost>(
    () => ({
      lang,
      setLang,
      termed: (copy, l) => termed(copy as object, l) as typeof copy,
      visionName: visionName(),
      transport: webTransport,
      links: LINKS,
      words: WORDS,
      prices: PRICES,
      onFocus,
      // The website's own overlay line and crest, as it has always drawn them.
      brand: { line: "THREE WOLVES · WOLF VISION", logoUrl: "/uploads/three-wolves-logo-white-mini.png" },
    }),
    [lang, setLang, onFocus],
  );
  return <VisionHostProvider host={host}>{children}</VisionHostProvider>;
}
