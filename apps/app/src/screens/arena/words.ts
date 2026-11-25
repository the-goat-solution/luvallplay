// The Arena's words: the website's own dictionary (packages/i18n "arena"),
// with the club's terms filled in and the three lines that name Three
// Wolves swapped for the club's own name. Rank names come from the ladder.
import { useCallback } from "react";
import { arena } from "@luvallplay/i18n/arena";
import { format, setTerms, type Vars } from "@luvallplay/i18n/format";
import { LADDER, rankName } from "@luvallplay/core/ranks";
import { useCurrentClub, useLang } from "../../hooks.tsx";

export type ArenaKey = keyof typeof arena.en;
export type ArenaT = (key: ArenaKey, vars?: Vars) => string;

export function useArenaT() {
  const { config } = useCurrentClub();
  const lang = useLang();
  const clubName = config?.club.name ?? "";
  const terms = config?.terms ?? null;
  const t: ArenaT = useCallback(
    (key, vars) => {
      setTerms(terms ?? { pointsName: "", visionName: "" });
      const d = arena[lang] as Record<string, string>;
      if (key === "eyebrow") return [clubName, d.seg_challenges].filter(Boolean).join(" · ");
      if (key === "invite_text") return [d.team_title, clubName].filter(Boolean).join(" · ");
      return format(d[key] ?? (arena.en as Record<string, string>)[key] ?? key, vars, lang);
    },
    [lang, terms, clubName],
  );
  const rank = useCallback((index: number) => rankName(LADDER[Math.max(0, Math.min(LADDER.length - 1, index))], lang), [lang]);
  return { t, rank, lang };
}
