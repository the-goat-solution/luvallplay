"use client";

import { useMemo } from "react";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { PlayerStats } from "@/lib/stats-db";
import styles from "../profile.module.css";
import p from "./player.module.css";

const PERIOD_KEYS: { key: "month" | "quarter" | "year" | "lifetime"; label: ProfileKey }[] = [
  { key: "month", label: "pl_this_month" },
  { key: "quarter", label: "pl_this_quarter" },
  { key: "year", label: "pl_this_year" },
  { key: "lifetime", label: "pl_lifetime" },
];

function weekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * One column per week, one row per weekday the club played. Cells: played,
 * the club played but you didn't, or no play day. Plain SVG: no chart
 * library, scales to any width.
 */
function Heatmap({ attended, clubDates, lang }: { attended: string[]; clubDates: string[]; lang: string }) {
  const { tr } = useProfileT();
  const model = useMemo(() => {
    const today = new Date();
    const end = weekKey(today.toISOString().slice(0, 10));
    const weeks: string[] = [];
    for (let i = 25; i >= 0; i--) {
      const d = new Date(`${end}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i * 7);
      weeks.push(d.toISOString().slice(0, 10));
    }
    const attendedSet = new Set(attended);
    const clubSet = new Set(clubDates);
    const dows = [...new Set([...clubDates, ...attended].filter((d) => d >= weeks[0]).map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()))].sort(
      (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
    );
    return { weeks, attendedSet, clubSet, dows: dows.length ? dows : [5] };
  }, [attended, clubDates]);

  const cell = 14;
  const gap = 4;
  const left = 34;
  const width = left + model.weeks.length * (cell + gap);
  const height = model.dows.length * (cell + gap) + 18;
  const dayName = (dow: number) =>
    new Date(Date.UTC(2026, 0, 4 + dow)).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { weekday: "short", timeZone: "UTC" });

  return (
    <figure className={p.heatmap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr("pl_heatmap_title")} preserveAspectRatio="xMinYMin meet">
        {model.dows.map((dow, r) => (
          <text key={dow} x={0} y={r * (cell + gap) + cell - 3} className={p.axis}>
            {dayName(dow)}
          </text>
        ))}
        {model.weeks.map((wk, c) =>
          model.dows.map((dow, r) => {
            const d = new Date(`${wk}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + ((dow + 6) % 7));
            const key = d.toISOString().slice(0, 10);
            const state = model.attendedSet.has(key) ? "on" : model.clubSet.has(key) ? "miss" : "none";
            return (
              <rect
                key={`${wk}-${dow}`}
                x={left + c * (cell + gap)}
                y={r * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                className={state === "on" ? p.cellOn : state === "miss" ? p.cellMiss : p.cellNone}
              >
                <title>{key}</title>
              </rect>
            );
          }),
        )}
        {model.weeks.map((wk, c) => {
          const d = new Date(`${wk}T00:00:00Z`);
          if (d.getUTCDate() > 7) return null;
          return (
            <text key={wk} x={left + c * (cell + gap)} y={height - 2} className={p.axis}>
              {d.toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { month: "short", timeZone: "UTC" })}
            </text>
          );
        })}
      </svg>
      <figcaption className={p.legend}>
        <span>
          <i className={p.cellOn} /> {tr("pl_heatmap_attended")}
        </span>
        <span>
          <i className={p.cellMiss} /> {tr("pl_heatmap_missed")}
        </span>
        <span>
          <i className={p.cellNone} /> {tr("pl_heatmap_none")}
        </span>
      </figcaption>
    </figure>
  );
}

/** Points per round robin day, newest on the right. */
function RrChart({ history }: { history: PlayerStats["rrHistory"] }) {
  const recent = history.slice(-16);
  const max = Math.max(4, ...recent.map((r) => r.points));
  const w = 320;
  const h = 120;
  const pad = 18;
  const step = recent.length > 1 ? (w - pad * 2) / (recent.length - 1) : 0;
  const pts = recent.map((r, i) => [pad + i * step, h - pad - (r.points / max) * (h - pad * 2)] as const);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={p.rrChart} role="img" aria-label="Round robin points per day" preserveAspectRatio="xMidYMid meet">
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className={p.baseline} />
      {pts.length > 1 && <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} className={p.line} />}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x || w / 2} cy={y} r={4.5} className={p.dot}>
          <title>{`${recent[i].date}: ${recent[i].points} pts`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function PlayerStatsView({ stats, leaderboardVisible }: { stats: PlayerStats; leaderboardVisible: boolean }) {
  const { tr, lang } = useProfileT();
  const ord = (n: number) => (n === 1 ? tr("ord_1") : n === 2 ? tr("ord_2") : n === 3 ? tr("ord_3") : tr("ord_n", { n }));
  const winRate = stats.rr.wins + stats.rr.losses > 0 ? Math.round((stats.rr.wins / (stats.rr.wins + stats.rr.losses)) * 100) : null;
  const rrByDate = new Map(stats.rrHistory.map((r) => [r.date, r]));
  const historyDates = [...new Set([...stats.attendedDates, ...stats.rrHistory.map((r) => r.date)])].sort().reverse().slice(0, 40);

  return (
    <div className={styles.stack}>
      <div className={styles.statGrid}>
        {PERIOD_KEYS.map((pk) => (
          <div key={pk.key} className={styles.stat}>
            <div className={styles.statValue}>{stats.attended[pk.key]}</div>
            <div className={styles.statLabel}>
              {tr("pl_play_days")} · {tr(pk.label)}
            </div>
          </div>
        ))}
        <div className={styles.stat} style={{ background: "var(--navy)", color: "#fff" }}>
          <div className={styles.statValue} style={{ color: "#fff" }}>
            🔥 {stats.streak.current}
          </div>
          <div className={styles.statLabel} style={{ color: "rgba(255,255,255,.75)" }}>
            {tr("pl_streak")} · {tr("pl_best_streak", { n: stats.streak.best })}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{stats.rr.points}</div>
          <div className={styles.statLabel}>{tr("pl_rr_points")}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{winRate === null ? "—" : `${winRate}%`}</div>
          <div className={styles.statLabel}>{tr("pl_win_rate")}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{stats.rr.bestPlacing ? ord(stats.rr.bestPlacing) : "—"}</div>
          <div className={styles.statLabel}>{tr("pl_best_finish")}</div>
        </div>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          {tr("pl_ranks_title")}
          <span>
            <a href="/profile/leaderboard" className={`${styles.btn} ${styles.ghost}`}>
              {tr("pl_see_leaderboard")} →
            </a>
          </span>
        </h2>
        {!leaderboardVisible && <div className={styles.notice}>{tr("pl_hidden_note")}</div>}
        <div className={p.rankTable} role="table">
          <div role="row" className={p.rankHead}>
            <span role="columnheader" />
            {PERIOD_KEYS.map((pk) => (
              <span role="columnheader" key={pk.key}>
                {tr(pk.label)}
              </span>
            ))}
          </div>
          {(["attendance", "rr"] as const).map((metric) => (
            <div role="row" key={metric} className={p.rankRow}>
              <span role="rowheader">{tr(metric === "attendance" ? "pl_rank_attendance" : "pl_rank_rr")}</span>
              {PERIOD_KEYS.map((pk) => {
                const rank = stats.ranks[pk.key][metric];
                return (
                  <span role="cell" key={pk.key} className={rank && rank <= 3 ? p.podium : undefined}>
                    {rank ? tr("pl_rank", { n: rank }) : tr("pl_not_ranked")}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <div className={styles.split}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{tr("pl_heatmap_title")}</h2>
          <Heatmap attended={stats.attendedDates} clubDates={stats.clubDates} lang={lang} />
        </section>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            {tr("pl_rr_title")}
            <span className={styles.small}>
              {stats.rr.days} {tr("pl_rr_days").toLowerCase()}
            </span>
          </h2>
          {stats.rrHistory.length === 0 ? <p className={styles.muted}>{tr("pl_rr_empty")}</p> : <RrChart history={stats.rrHistory} />}
        </section>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{tr("pl_history_title")}</h2>
        {historyDates.length === 0 ? (
          <p className={styles.muted}>{tr("pl_history_empty")}</p>
        ) : (
          <ul className={p.history}>
            {historyDates.map((d) => {
              const rr = rrByDate.get(d);
              return (
                <li key={d}>
                  <time dateTime={d}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
                      timeZone: "UTC",
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                  <span>
                    {rr
                      ? tr("pl_history_rr", { pts: rr.points, w: rr.wins, l: rr.losses, place: tr("pl_rr_place", { place: ord(rr.placing), teams: rr.teams }) })
                      : "🏸"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
