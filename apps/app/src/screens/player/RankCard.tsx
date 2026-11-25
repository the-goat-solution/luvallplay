// The Player tab's rank: points, league step, how far to the next rank, the
// split by source, the kit bag and achievements; then the whole ladder. With
// the ladder's own pictures, as on the website.
import { useState } from "react";
import { AchievementIcon, RankIcon } from "../../components/RankIcon.tsx";
import { ACHIEVEMENTS, ITEMS, LADDER, LEAGUES, nextRank } from "@luvallplay/core/ranks";
import type { ArenaState } from "../arena/data.ts";
import { useArenaT } from "../arena/words.ts";

type Me = NonNullable<ArenaState["me"]>;

export function RankCard({ me, locale }: { me: Me; locale: string }) {
  const { t, rank: name, lang } = useArenaT();
  const r = me.rank;
  const current = LADDER[r.shown];
  const next = nextRank(Math.min(r.earned, LADDER.length - 1));
  const kit = LADDER.slice(0, Math.min(LADDER.length, r.earned + 4));
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <>
      <section className="card stack rank-card" aria-labelledby="rank-title">
        <h2 id="rank-title">{t("wp_title")}</h2>
        <div className="rank-hero">
          <RankIcon index={r.shown} tarnished={r.tarnishing} px={92} />
        <div className="stack-tight">
          <span className={`rank-name${r.tarnishing ? " tarnished" : ""}`}>{name(r.shown)}</span>
          <span className="muted small">{t("league_step", { league: LEAGUES[current.league][lang], s: current.step, n: current.steps })}</span>
          <span className="score-big">{t("wp_total", { n: r.wpTotal })}</span>
          {r.seat && (
            <span className="pill pill-active seat-pill">
              <RankIcon index={r.shown} seat={r.seat} px={20} />
              {t(r.seat === "alpha" ? "seat_alpha" : "seat_silver")}
            </span>
          )}
        </div>
        </div>
        <progress max={1} value={r.progress} aria-label={next ? t("to_next", { n: Math.max(0, next.wp - r.wpTotal), rank: name(next.index) }) : t("top")} />
        <p className="small">{next ? t("to_next", { n: Math.max(0, next.wp - r.wpTotal), rank: name(next.index) }) : t("top")}</p>
        {r.tarnishing && <p className="notice">{r.daysToSlip ? t("tarnishing", { d: r.daysToSlip }) : t("tarnishing_floor")}</p>}
        <dl className="stats stats-4">
          {([["wp_play_days", r.wpPlayDays], ["wp_rr", r.wpRoundRobin], ["wp_challenges", r.wpChallenges], ["wp_bonuses", r.wpBonuses]] as const).map(([k, v]) => (
            <div key={k} className="stat"><dt>{t(k)}</dt><dd className="stat-value">{v}</dd></div>
          ))}
        </dl>
        <p className="muted small"><strong>{t("how_title")}.</strong> {t("how_body")}</p>
      </section>
      <section className="card stack" aria-labelledby="kit-title">
        <h2 id="kit-title">{t("kit_bag")}</h2>
        <ul className="kit">
          {kit.map((k) => (
            <li key={k.index}>
              <button type="button" className={`kit-item${k.index > r.earned ? " locked" : ""}`} aria-pressed={picked === k.index} onClick={() => setPicked(k.index)}>
                <RankIcon index={k.index} px={52} />
                <span className="small">{name(k.index)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small" aria-live="polite">{picked !== null ? `${name(picked)} · ${LADDER[picked].wp} WP` : t("kit_bag_body")}</p>
      </section>
      <section className="card stack" aria-labelledby="ach-title">
        <h2 id="ach-title">{t("achievements")}</h2>
        <ul className="achievements">
          {ACHIEVEMENTS.map((a) => {
            const when = me.achievements[a.key];
            return (
              <li key={a.key} className={when ? "earned" : "locked"}>
                <AchievementIcon kind={a.key} px={52} />
                <strong>{a[lang]}</strong>
                <span className="muted small">
                  {when ? new Date(`${when}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : a.how[lang]}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

export function RankLadder({ me }: { me: Me | null }) {
  const { t, lang } = useArenaT();
  const tiers = LADDER.filter((r, i) => i === 0 || LADDER[i - 1].item !== r.item);
  const mine = me ? LADDER[me.rank.shown].item : null;
  return (
    <section className="card stack" aria-labelledby="ladder-title">
      <h2 id="ladder-title">{t("ranks_title")}</h2>
      <p className="muted small">{t("ranks_sub")}</p>
      <ol className="rows ladder">
        {[...tiers].reverse().map((r) => (
          <li key={r.index} className={`row${r.item === mine ? " ladder-here" : ""}`} aria-current={r.item === mine ? "true" : undefined}>
            <RankIcon index={r.index} px={34} />
            <span className="row-text">
              <strong>{ITEMS[r.item][lang]}</strong>
              <span className="muted small">{r.wp > 0 ? t("ranks_from", { n: r.wp }) : t("ranks_start")}</span>
            </span>
            {r.item === mine && <span className="pill pill-active">{t("ranks_you_here")}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
