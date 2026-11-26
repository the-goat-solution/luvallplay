// A tracked game's report, as a broadcast's end card: the rallies, the
// longest, the fastest shot, then each player's hits (with a bar against
// the busiest), distance and top speed. The Arena's Stats window and the
// Vision tab both show it.
import type { CSSProperties } from "react";
import type { ArenaT } from "../screens/arena/words.ts";

export type ReportStats = {
  rallies: number;
  longestRally: number;
  fastestShotKmh: number | null;
  players: { playerId: number; hits: number; distance: number; topSpeed: number }[];
};

export function MatchReport({ stats, names, t }: { stats: ReportStats; names: string[]; t: ArenaT }) {
  const most = Math.max(1, ...stats.players.map((p) => p.hits));
  return (
    <div className="report">
      <dl className="report-kpis">
        <div className="report-kpi"><dt>{t("stats_rallies")}</dt><dd>{stats.rallies}</dd></div>
        <div className="report-kpi"><dt>{t("stats_longest")}</dt><dd>{stats.longestRally}</dd></div>
        <div className="report-kpi report-kpi-flood"><dt>{t("stats_fastest")}</dt><dd>{stats.fastestShotKmh ?? "–"}<small>km/h</small></dd></div>
      </dl>
      <div className="table-wrap">
        <table className="stats-table report-table">
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">{t("stats_title")}</span></th>
              <th scope="col">{t("stats_hits")}</th>
              <th scope="col">{t("stats_dist")}</th>
              <th scope="col">{t("stats_speed")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.players.map((p, i) => (
              <tr key={p.playerId}>
                <th scope="row"><span className={`player-dot player-dot-${i}`} aria-hidden="true" /> {names[i] ?? ""}</th>
                <td>
                  <span className="report-hits">
                    <span className={`report-bar report-bar-${i}`} style={{ "--v": p.hits / most } as CSSProperties} aria-hidden="true" />
                    {p.hits}
                  </span>
                </td>
                <td>{p.distance.toFixed(1)} m</td>
                <td>{p.topSpeed.toFixed(1)} m/s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
