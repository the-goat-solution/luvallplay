"use client";

import { useId, useMemo } from "react";
import { LADDER, rankName, type AchievementKey, type Seat } from "@/lib/ranks";
import { achievementArt, bonusArt, crownArt, rankArt, seatArt, type BonusKind, type CrownKind } from "@/lib/rank-art";
import { useArenaT } from "@/lib/arena-i18n";

type Base = { px?: number; className?: string; title?: string; color?: string };

function Svg({ markup, label, px = 24, className, color }: { markup: string; label: string; px?: number; className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      role="img"
      aria-label={label}
      className={className}
      style={{ color: color ?? "#184467", flex: "none", overflow: "visible" }}
      dangerouslySetInnerHTML={{ __html: `<title>${label.replace(/[<&]/g, "")}</title>${markup}` }}
    />
  );
}

/** A rank on the ladder (or a Wolf seat). Bold drawing at 32 px and below, fine drawing above. */
export function RankIcon({ index, seat = null, tarnished = false, px = 24, className, color }: Base & { index: number; seat?: Seat | null; tarnished?: boolean }) {
  const { t, lang } = useArenaT();
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const size = px > 32 ? "lg" : "sm";
  const markup = useMemo(
    () => (seat ? seatArt(seat, size, `ri${raw}`) : rankArt(Math.max(0, Math.min(LADDER.length - 1, index)), size, `ri${raw}`)),
    [index, seat, size, raw],
  );
  const label = seat ? t(seat === "alpha" ? "seat_alpha" : "seat_silver") : rankName(LADDER[Math.max(0, Math.min(LADDER.length - 1, index))], lang);
  return (
    <Svg
      markup={markup}
      label={tarnished ? `${label} · ${t("tarnishing").split(":")[0]}` : label}
      px={px}
      className={className}
      color={color}
    />
  );
}

export function CrownIcon({ kind, px = 48, className, label }: Base & { kind: CrownKind; label: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  return <Svg markup={crownArt(kind, px > 32 ? "lg" : "sm", `ci${raw}`)} label={label} px={px} className={className} />;
}

export function BonusIcon({ kind, px = 18, className, color }: Base & { kind: BonusKind }) {
  return <Svg markup={bonusArt(kind)} label="" px={px} className={className} color={color} />;
}

export function AchievementIcon({ kind, px = 48, className, label }: Base & { kind: AchievementKey; label: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  return <Svg markup={achievementArt(kind, px > 32 ? "lg" : "sm", `ai${raw}`)} label={label} px={px} className={className} />;
}
