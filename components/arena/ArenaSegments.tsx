"use client";

import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { useArenaT } from "@/lib/arena-i18n";
import seg from "./segments.module.css";

export type ArenaSegment = "challenges" | "leaderboard" | "ranks";
const ARENA_SEGMENTS: ArenaSegment[] = ["challenges", "leaderboard", "ranks"];

const LABEL = { challenges: "seg_challenges", leaderboard: "seg_leaderboard", ranks: "seg_ranks" } as const;

/** Challenges · Leaderboard · Ranks (build plan §2.1). Links, so each segment has its own URL. */
export function ArenaSegments({ active }: { active: ArenaSegment }) {
  const { t } = useArenaT();
  return (
    <nav className={seg.segments} aria-label={t("seg_label")}>
      {ARENA_SEGMENTS.map((s) => (
        <Link
          key={s}
          href={s === "challenges" ? "/profile/arena" : `/profile/arena?tab=${s}`}
          className={`${seg.segment} ${active === s ? seg.on : ""}`}
          aria-current={active === s ? "page" : undefined}
          scroll={false}
        >
          <LinkPending>{t(LABEL[s])}</LinkPending>
        </Link>
      ))}
    </nav>
  );
}
