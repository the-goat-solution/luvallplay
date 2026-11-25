// The tracker itself (packages/vision, the same one the website shows): a
// live match on this phone's camera or a match video, for an Arena
// challenge (?challenge=ID) or any game. Its calls go to the club's API
// (/clubs/{club}/vision/…), which answers as the website's routes do.
import { useMemo } from "react";
import { API_PREFIX } from "@luvallplay/api/routes";
import { format, setTerms } from "@luvallplay/i18n/format";
import { MatchAnalyzer, VisionHostProvider, fillTerms, type VisionHost, type VisionTransport } from "@luvallplay/vision/ui";
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
    if (res.status === 401 && token) store.signOut();
    return res;
  };
}

const setFocus = (on: boolean) => focus.set(on);

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
      // The prices after the trial, from the club's API, in its money; the words for a player and a pair are plain.
      prices: prices ? { live: money(prices.live, currency), upload: money(prices.upload, currency) } : { live: "…", upload: "…" },
      onFocus: setFocus,
    };
  }, [slug, current, lang, terms, prices, currency]);

  if (!host) return null;
  return (
    <div className="screen tracker" data-screen="vision_track">
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
  );
}
