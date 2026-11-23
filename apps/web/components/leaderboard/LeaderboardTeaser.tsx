"use client";

import { useSyncExternalStore } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { t } from "@/lib/i18n";
import type { TeaserRow } from "@/lib/leaderboard-data";
import s from "./teaser.module.css";

/**
 * Home-page leaderboard teaser (build plan §2.3): this month's top five,
 * first names only, and a way into the app for the full board. Players who
 * opted out never appear (the board leaves them out). The old /leaderboard
 * URL lands here (#leaderboard) for people who aren't signed in.
 */
const noopSubscribe = () => () => {};
const serverFalse = () => false;
const readJustHidden = () => new URLSearchParams(window.location.search).get("hidden") === "1";

export function LeaderboardTeaser({ rows }: { rows: TeaserRow[] }) {
  const { lang } = useLanguage();
  // ?hidden=1: back from the one-click opt-out link in the welcome email.
  // Read on the client only (server snapshot is false) to avoid a hydration mismatch.
  const justHidden = useSyncExternalStore(noopSubscribe, readJustHidden, serverFalse);

  return (
    <section id="leaderboard" className={s.section} aria-labelledby="lb-teaser-title">
      <div className={s.inner}>
        <div className={s.kicker}>{t(lang, "lb_teaser_kicker")}</div>
        <h2 id="lb-teaser-title" className={s.title}>
          {t(lang, "lb_teaser_title")}
        </h2>
        <p className={s.sub}>{t(lang, "lb_teaser_sub")}</p>
        {justHidden && (
          <p className={s.note} role="status">
            {t(lang, "lb_teaser_hidden")}
          </p>
        )}
        {rows.length === 0 ? (
          <p className={s.empty}>{t(lang, "lb_teaser_empty")}</p>
        ) : (
          <ol className={s.list}>
            {rows.map((r) => (
              <li key={`${r.rank}-${r.firstName}`}>
                <span className={`${s.rank} ${r.rank <= 3 ? s[`top${r.rank}`] : ""}`}>{r.rank}</span>
                <span className={s.name}>{r.firstName}</span>
                <span className={s.points}>{t(lang, "lb_teaser_wp", { n: r.points })}</span>
              </li>
            ))}
          </ol>
        )}
        <a href="/login?next=%2Fprofile%2Farena%3Ftab%3Dleaderboard" className={s.cta}>
          {t(lang, "lb_teaser_cta")} <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
