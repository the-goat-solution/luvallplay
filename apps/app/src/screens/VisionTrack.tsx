// The tracker itself (packages/vision, the same one the website shows): a
// live match on this phone's camera or a match video, for an Arena
// challenge (?challenge=ID) or any game. Its calls go to the club's API
// (/clubs/{club}/vision/…), which answers as the website's routes do.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { API_PREFIX } from "@luvallplay/api/routes";
import { format, setTerms } from "@luvallplay/i18n/format";
import { MatchAnalyzer, VisionHostProvider, fillTerms, type VisionHost, type VisionTransport } from "@luvallplay/vision/ui";
import type { OverlayTheme } from "@luvallplay/vision/host";
import { Stage } from "../components/Stage.tsx";
import { clubWords } from "../lib/club-words.ts";
import { clubHost, store } from "../app.ts";
import { useCurrentClub, useLang, useSession } from "../hooks.tsx";
import { focus } from "../lib/focus.ts";
import { money } from "../lib/format.ts";
import { usePlace } from "./me/parts.tsx";
import { useVisionStatus } from "./vision/data.ts";

function clubTransport(host: string, club: string): VisionTransport {
  return async (endpoint, { method = "GET", query, body, keepalive } = {}) => {
    const base = `${host}${API_PREFIX}/clubs/${encodeURIComponent(club)}/vision`;
    const { challenge, ...rest } = query ?? {};
    const path = endpoint === "challenge" ? `/challenges/${encodeURIComponent(challenge ?? "")}` : `/${endpoint}`;
    const qs = Object.keys(rest).length ? `?${new URLSearchParams(rest)}` : "";
    const token = store.get().token;
    const res = await fetch(`${base}${path}${qs}`, {
      method,
      keepalive,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // The session was refused: signed out, as every other call does.
    if (res.status === 401 && token && token === store.get().token) store.signOut();
    return res;
  };
}

const setFocus = (on: boolean) => focus.set(on);

/**
 * The overlay's colours and fonts, read from the stage (the club's dark
 * theme): the canvas can't use CSS custom properties, so each token is
 * resolved through a probe element to a colour the canvas understands.
 */
function readOverlayLook(el: HTMLElement): Partial<OverlayTheme> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  el.appendChild(probe);
  const colour = (css: string) => {
    probe.style.color = "";
    probe.style.color = css;
    return getComputedStyle(probe).color;
  };
  const font = (css: string) => {
    probe.style.fontFamily = css;
    return getComputedStyle(probe).fontFamily;
  };
  const look: Partial<OverlayTheme> = {
    players: [
      colour("var(--side-you)"),
      colour("color-mix(in oklab, var(--side-you) 55%, white)"),
      colour("var(--side-them)"),
      colour("color-mix(in oklab, var(--side-them) 55%, white)"),
    ],
    highlight: colour("var(--flood)"),
    onHighlight: colour("var(--on-flood)"),
    brand: colour("var(--accent)"),
    panel: colour("color-mix(in srgb, var(--stage-deep) 82%, transparent)"),
    panelSoft: colour("color-mix(in srgb, var(--stage) 72%, transparent)"),
    muted: colour("var(--ink-muted)"),
    sans: font("var(--font-text)"),
    display: font("var(--font-display)"),
  };
  probe.remove();
  return look;
}

export default function VisionTrackScreen() {
  const { current, slug, config } = useCurrentClub();
  const lang = useLang();
  const session = useSession();
  const { currency } = usePlace();
  const prices = useVisionStatus().data?.prices;
  const terms = config?.terms ?? null;
  const params = new URLSearchParams(window.location.search);
  const challengeId = Number(params.get("challenge"));
  const demo = params.get("demo") === "1";
  const player = session.data?.player;
  const stageRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<Partial<OverlayTheme> | undefined>(undefined);
  const theme = config?.theme;
  useLayoutEffect(() => {
    const el = stageRef.current?.closest<HTMLElement>("[data-stage]");
    if (el) setOverlay(readOverlayLook(el));
  }, [theme]);
  const me = player ? { id: player.id, name: player.displayName || `${player.firstName} ${player.lastName}`.trim(), avatarUrl: player.avatarUrl } : null;

  const host = useMemo<VisionHost | null>(() => {
    if (!slug || !current) return null;
    const fill = (l: "en" | "vi") => (text: string) => {
      setTerms(terms ?? { pointsName: "", visionName: "" });
      return format(text, undefined, l);
    };
    return {
      lang,
      setLang: (l) => store.set({ lang: l }),
      termed: (copy, l) => fillTerms(copy, fill(l)),
      visionName: fill(lang)("{visionName}"),
      transport: clubTransport(clubHost(current.apiBase), slug),
      links: { arena: "/arena", tracker: "/vision/track", label: "/vision/label", signIn: () => "/signin" },
      words: clubWords(terms),
      // The prices after the trial, from the club's API, in its money.
      prices: prices ? { live: money(prices.live, currency), upload: money(prices.upload, currency) } : { live: "…", upload: "…" },
      onFocus: setFocus,
      // The club's name and its tracker's on the overlay (and in recordings), in the club's colours.
      brand: { line: [config?.club.name, fill(lang)("{visionName}")].filter(Boolean).join(" · ").toUpperCase() },
      overlay,
    };
  }, [slug, current, lang, terms, prices, currency, config, overlay]);

  if (!host) return <Stage foldSplit={false}><div ref={stageRef} /></Stage>;
  return (
    <Stage foldSplit={false}>
    <div className="screen tracker" data-screen="vision_track" ref={stageRef}>
      <VisionHostProvider host={host}>
        <MatchAnalyzer
          challengeId={Number.isInteger(challengeId) && challengeId > 0 ? challengeId : null}
          sandbox={import.meta.env.DEV || demo}
          demo={demo}
          embedded
          me={me}
        />
      </VisionHostProvider>
    </div>
    </Stage>
  );
}
