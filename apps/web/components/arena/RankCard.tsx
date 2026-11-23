"use client";

import { useState } from "react";
import { useArenaT } from "@/lib/arena-i18n";
import { ACHIEVEMENTS, LADDER, LEAGUES, nextRank, rankName } from "@/lib/ranks";
import type { MeView } from "@/lib/arena-state";
import { AchievementIcon, RankIcon } from "./RankIcon";
import styles from "@/components/profile/profile.module.css";
import r from "./rankcard.module.css";

/** Player tab: rank, Wolf Points, kit bag and achievements. */
export function RankCard({ me }: { me: MeView }) {
  const { t, lang } = useArenaT();
  const rank = me.rank;
  const current = LADDER[rank.shown];
  const next = nextRank(Math.min(rank.earned, LADDER.length - 1));
  const [picked, setPicked] = useState<number | null>(null);
  const earnedUpTo = rank.earned;
  const kit = LADDER.slice(0, Math.min(LADDER.length, earnedUpTo + 4));

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t("wp_title")}</h2>
        <div className={r.hero}>
          <span className={`${r.heroIcon} ${rank.tarnishing ? r.locked : ""}`} style={rank.tarnishing ? { opacity: 0.85, filter: "grayscale(.7)" } : undefined}>
            <RankIcon index={rank.shown} px={92} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className={r.rankName}>{rankName(current, lang)}</div>
            <div className={r.step}>{t("league_step", { league: LEAGUES[current.league][lang], s: current.step, n: current.steps })}</div>
            <div className={r.total}>{t("wp_total", { n: rank.wpTotal })}</div>
            {rank.seat && (
              <span className={r.seat}>
                <RankIcon index={0} seat={rank.seat} px={20} />
                {t(rank.seat === "alpha" ? "seat_alpha" : "seat_silver")}
              </span>
            )}
          </div>
        </div>
        <div className={r.bar}>
          <i style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
        <div className={r.next}>{next ? t("to_next", { n: Math.max(0, next.wp - rank.wpTotal), rank: rankName(next, lang) }) : t("top")}</div>
        {rank.tarnishing && <div className={r.tarnish}>{rank.daysToSlip ? t("tarnishing", { d: rank.daysToSlip }) : t("tarnishing_floor")}</div>}
        <div className={r.split}>
          <div>
            <b>{rank.wpPlayDays}</b>
            {t("wp_play_days")}
          </div>
          <div>
            <b>{rank.wpRoundRobin}</b>
            {t("wp_rr")}
          </div>
          <div>
            <b>{rank.wpChallenges}</b>
            {t("wp_challenges")}
          </div>
          <div>
            <b>{rank.wpBonuses}</b>
            {t("wp_bonuses")}
          </div>
        </div>
        <a className={r.arena} href="/profile/arena">
          ⚔️ {t("go_arena")}
        </a>
        <p className={r.how}>
          <b>{t("how_title")}.</b> {t("how_body")}
        </p>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t("kit_bag")}</h2>
        <div className={r.kit}>
          {kit.map((k) => (
            <button key={k.index} type="button" onClick={() => setPicked(k.index)} className={k.index > earnedUpTo ? r.locked : undefined} aria-label={rankName(k, lang)}>
              <RankIcon index={k.index} px={52} />
            </button>
          ))}
        </div>
        <p className={r.kitNote}>
          {picked !== null ? `${rankName(LADDER[picked], lang)} · ${LADDER[picked].wp} WP` : t("kit_bag_body")}
        </p>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t("achievements")}</h2>
        <div className={r.ach}>
          {ACHIEVEMENTS.map((a) => {
            const when = me.achievements[a.key];
            return (
              <div key={a.key} className={when ? undefined : r.off}>
                <AchievementIcon kind={a.key} px={52} label={a[lang]} />
                <div>{a[lang]}</div>
                <small>{when ? new Date(`${when}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : a.how[lang]}</small>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
