"use client";

import { useArenaT } from "@/lib/arena-i18n";
import { ITEMS, LADDER } from "@/lib/ranks";
import type { MeView } from "@/lib/arena-state";
import { RankCard } from "./RankCard";
import { RankIcon } from "./RankIcon";
import styles from "@/components/profile/profile.module.css";
import seg from "./segments.module.css";

/** The Arena's Ranks segment: your rank card, then the whole ladder by tier. */
export function RanksView({ me }: { me: MeView | null }) {
  const { t, lang } = useArenaT();
  // One row per tier (the first step of each item: Plastic Shuttle … Diamond Racket).
  const tiers = LADDER.filter((r, i) => i === 0 || LADDER[i - 1].item !== r.item);
  const myTier = me ? LADDER[me.rank.shown].item : null;
  return (
    <div className={styles.stack}>
      {me && <RankCard me={me} />}
      <section className={styles.card} aria-labelledby="ladder-title">
        <h2 id="ladder-title" className={styles.cardTitle}>
          {t("ranks_title")}
        </h2>
        <p className={styles.small} style={{ marginBottom: 10 }}>
          {t("ranks_sub")}
        </p>
        <ol className={seg.ladder}>
          {[...tiers].reverse().map((r) => (
            <li key={r.index} className={r.item === myTier ? seg.here : undefined}>
              <RankIcon index={r.index} px={34} />
              <span className={seg.tierName}>{ITEMS[r.item][lang]}</span>
              <small>{r.wp > 0 ? t("ranks_from", { n: r.wp }) : t("ranks_start")}</small>
              {r.item === myTier && <em>{t("ranks_you_here")}</em>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
