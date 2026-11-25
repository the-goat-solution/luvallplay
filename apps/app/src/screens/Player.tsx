// The Player tab, as on the website: your rank (points, kit bag,
// achievements) when the club has the Arena, your play stats and board
// places, the last 26 weeks, round robin, your history, and the ladder.
import { Link } from "@tanstack/react-router";
import { useCurrentClub, useLang, useT } from "../hooks.tsx";
import { localeOf } from "../lib/format.ts";
import { useArena } from "./arena/data.ts";
import { Heatmap, RrChart } from "./player/Charts.tsx";
import { usePlayerStats } from "./player/data.ts";
import { RankCard, RankLadder } from "./player/RankCard.tsx";

const PERIODS = [["month", "pl_this_month"], ["quarter", "pl_this_quarter"], ["year", "pl_this_year"], ["lifetime", "pl_lifetime"]] as const;

export default function PlayerScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const locale = localeOf(lang, config?.club.country ?? "");
  const stats = usePlayerStats();
  const arenaOn = !!config?.modules.includes("arena");
  const arena = useArena();
  const s = stats.data;
  const ord = (n: number) => (n === 1 ? t("ord_1") : n === 2 ? t("ord_2") : n === 3 ? t("ord_3") : t("ord_n", { n }));
  const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

  if (!s) {
    return (
      <div className="screen" data-screen="nav_player" data-state={stats.isError ? "error" : "loading"}>
        <h1>{t("pl_title")}</h1>
        {stats.isError ? (
          <p className="notice notice-error" role="alert">{t("me_retry_load")} <button type="button" className="button button-small" onClick={() => void stats.refetch()}>↻</button></p>
        ) : (
          <div className="skeleton skeleton-tall" aria-busy="true" />
        )}
      </div>
    );
  }

  const games = s.rr.wins + s.rr.losses;
  const winRate = games > 0 ? `${Math.round((s.rr.wins / games) * 100)}%` : "—";
  const rrByDate = new Map(s.rrHistory.map((r) => [r.date, r]));
  const history = [...new Set([...s.attendedDates, ...s.rrHistory.map((r) => r.date)])].sort().reverse().slice(0, 40);

  return (
    <div className="screen player" data-screen="nav_player" data-state="ready">
      <h1>{t("pl_title")}</h1>
      <div className="me-grid">
        <div className="stack">
          {arenaOn && arena.data?.me && <RankCard me={arena.data.me} locale={locale} />}
          <dl className="stats stats-4">
            {PERIODS.map(([k, label]) => (
              <div key={k} className="stat"><dt>{t("pl_play_days")} · {t(label)}</dt><dd className="stat-value">{s.attended[k]}</dd></div>
            ))}
            <div className="stat stat-feature"><dt>{t("pl_streak")} · {t("pl_best_streak", { n: s.streak.best })}</dt><dd className="stat-value">🔥 {s.streak.current}</dd></div>
            <div className="stat"><dt>{t("pl_rr_points")}</dt><dd className="stat-value">{s.rr.points}</dd></div>
            <div className="stat"><dt>{t("pl_win_rate")}</dt><dd className="stat-value">{winRate}</dd></div>
            <div className="stat"><dt>{t("pl_best_finish")}</dt><dd className="stat-value">{s.rr.bestPlacing ? ord(s.rr.bestPlacing) : "—"}</dd></div>
          </dl>
          <section className="card stack" aria-labelledby="places-title">
            <div className="card-head">
              <h2 id="places-title">{t("pl_ranks_title")}</h2>
              {arenaOn && <Link to="/leaderboard" className="button button-quiet button-small">{t("pl_see_leaderboard")} →</Link>}
            </div>
            {s.ranks.lifetime.attendance === null && s.attended.lifetime > 0 && <p className="notice">{t("pl_hidden_note")}</p>}
            <div className="table-wrap">
              <table className="places">
                <thead>
                  <tr><td />{PERIODS.map(([k, label]) => <th key={k} scope="col">{t(label)}</th>)}</tr>
                </thead>
                <tbody>
                  {(["attendance", "rr"] as const).map((m) => (
                    <tr key={m}>
                      <th scope="row">{t(m === "attendance" ? "pl_rank_attendance" : "pl_rank_rr")}</th>
                      {PERIODS.map(([k]) => {
                        const n = s.ranks[k][m];
                        return <td key={k} className={n && n <= 3 ? "podium" : undefined}>{n ? t("pl_rank", { n }) : t("pl_not_ranked")}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="card stack" aria-labelledby="heat-title">
            <h2 id="heat-title">{t("pl_heatmap_title")}</h2>
            <Heatmap attended={s.attendedDates} clubDates={s.clubDates} locale={locale} labels={{ title: t("pl_heatmap_title"), on: t("pl_heatmap_attended"), miss: t("pl_heatmap_missed"), none: t("pl_heatmap_none") }} />
          </section>
          <section className="card stack" aria-labelledby="rr-title">
            <div className="card-head">
              <h2 id="rr-title">{t("pl_rr_title")}</h2>
              <span className="muted small">{s.rr.days} {t("pl_rr_days").toLowerCase()}</span>
            </div>
            {s.rrHistory.length === 0 ? <p className="muted">{t("pl_rr_empty")}</p> : <RrChart history={s.rrHistory} label={t("pl_rr_title")} />}
          </section>
          <section className="card stack" aria-labelledby="history-title">
            <h2 id="history-title">{t("pl_history_title")}</h2>
            {history.length === 0 ? (
              <p className="muted">{t("pl_history_empty")}</p>
            ) : (
              <ul className="rows">
                {history.map((d) => {
                  const rr = rrByDate.get(d);
                  return (
                    <li key={d} className="row">
                      <span className="row-text">
                        <time dateTime={d}>{date(d)}</time>
                        <span className="muted small">{rr ? t("pl_history_rr", { pts: rr.points, w: rr.wins, l: rr.losses, place: t("pl_rr_place", { place: ord(rr.placing), teams: rr.teams }) }) : "🏸"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {arenaOn && <RankLadder me={arena.data?.me ?? null} />}
        </div>
      </div>
    </div>
  );
}
