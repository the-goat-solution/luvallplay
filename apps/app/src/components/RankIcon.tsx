// The ladder's own pictures (packages/core/src/rank-art.ts, the same drawings
// as the website): a rank, a top seat, an achievement. A bold drawing at 32
// px and below, the fine one above. Strokes follow the text colour, so they
// work in light and dark.
import { useId, useMemo } from "react";
import { ACHIEVEMENTS, LADDER, type AchievementKey, type Seat } from "@luvallplay/core/ranks";
import { achievementArt, artSetOf, rankArt, seatArt } from "@luvallplay/core/rank-art";
import { useArenaT } from "../screens/arena/words.ts";
import { useCurrentClub } from "../hooks.tsx";

/** The club's drawings: its own (Three Wolves') or Luvallplay's plain set in its colours. */
function useArtSet() {
  return artSetOf(useCurrentClub().config?.theme.artSet);
}

function Svg({ markup, label, px, className }: { markup: string; label: string; px: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      role="img"
      aria-label={label}
      className={`art${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: `<title>${label.replace(/[<&]/g, "")}</title>${markup}` }}
    />
  );
}

const clamp = (i: number) => Math.max(0, Math.min(LADDER.length - 1, i));

export function RankIcon({ index, seat = null, tarnished = false, px = 24, className }: { index: number; seat?: Seat | null; tarnished?: boolean; px?: number; className?: string }) {
  const { t, rank } = useArenaT();
  const set = useArtSet();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const size = px > 32 ? "lg" : "sm";
  const markup = useMemo(() => (seat ? seatArt(seat, size, `ri${id}`, set) : rankArt(clamp(index), size, `ri${id}`, set)), [index, seat, size, id, set]);
  const label = seat ? t(seat === "alpha" ? "seat_alpha" : "seat_silver") : rank(index);
  return <Svg markup={markup} label={tarnished ? `${label} · ${t("tarnishing").split(":")[0]}` : label} px={px} className={`${tarnished ? "art-tarnished " : ""}${className ?? ""}`.trim()} />;
}

export function AchievementIcon({ kind, px = 48, className }: { kind: AchievementKey; px?: number; className?: string }) {
  const { lang } = useArenaT();
  const set = useArtSet();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const markup = useMemo(() => achievementArt(kind, px > 32 ? "lg" : "sm", `ai${id}`, set), [kind, px, id, set]);
  return <Svg markup={markup} label={ACHIEVEMENTS.find((a) => a.key === kind)?.[lang] ?? kind} px={px} className={className} />;
}
