// A game's tracked stats, from the feed's "Stats" chip, as the website's
// window: rallies, the longest, the fastest shot, then each player's hits,
// distance and top speed, and who recorded it.
import { Dialog } from "./Dialogs.tsx";
import { useMatchStats } from "./data.ts";
import type { ArenaT } from "./words.ts";

export function MatchStats({ id, t, onClose }: { id: number; t: ArenaT; onClose: () => void }) {
  const q = useMatchStats(id);
  const stats = q.data?.stats;
  const names = q.data ? q.data.setup.teams.flatMap((team) => team.players.map((p) => p.name)) : [];
  return (
    <Dialog label={t("stats_title")} onClose={onClose}>
      <h2>{t("stats_title")}</h2>
      {q.isPending ? (
        <p className="muted" aria-busy="true">{t("stats_loading")}</p>
      ) : q.isError || !stats ? (
        <p>{t("stats_failed")}</p>
      ) : (
        <div className="stack" data-testid="match-stats">
          <dl className="stats">
            <div className="stat"><dt>{t("stats_rallies")}</dt><dd className="stat-value">{stats.rallies}</dd></div>
            <div className="stat"><dt>{t("stats_longest")}</dt><dd className="stat-value">{stats.longestRally}</dd></div>
            <div className="stat"><dt>{t("stats_fastest")} (km/h)</dt><dd className="stat-value">{stats.fastestShotKmh ?? "–"}</dd></div>
          </dl>
          <div className="table-wrap">
            <table className="stats-table">
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
                    <td>{p.hits}</td>
                    <td>{p.distance.toFixed(1)} m</td>
                    <td>{p.topSpeed.toFixed(1)} m/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t("stats_by", { name: stats.recordedBy.name, mode: t(stats.mode === "live" ? "stats_mode_live" : "stats_mode_upload") })}</p>
        </div>
      )}
      <div><button type="button" className="button button-quiet" onClick={onClose}>{t("card_close")}</button></div>
    </Dialog>
  );
}
