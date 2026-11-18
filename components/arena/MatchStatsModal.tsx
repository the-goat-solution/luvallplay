"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/modals/ModalShell";
import { useArenaT } from "@/lib/arena-i18n";
import type { MatchSetup, SavedMatchStats } from "@/lib/match-stats-db";
import s from "./arena.module.css";

const COLORS = ["#38bdf8", "#34d399", "#c084fc", "#fb923c"];

/** Match Analyzer stats a court assistant saved for a challenge. */
export function MatchStatsModal({ challengeId, onClose }: { challengeId: number; onClose: () => void }) {
  const { t } = useArenaT();
  const [data, setData] = useState<{ setup: MatchSetup; stats: SavedMatchStats | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/arena/match-stats?challenge=${challengeId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [challengeId]);

  const stats = data?.stats;
  const names = data ? data.setup.teams.flatMap((tm) => tm.players.map((p) => p.name)) : [];
  return (
    <ModalShell id="match-stats" open onClose={onClose} title={t("stats_title")}>
      {failed ? (
        <p>{t("stats_failed")}</p>
      ) : !data ? (
        <p>{t("stats_loading")}</p>
      ) : !stats ? (
        <p>{t("stats_failed")}</p>
      ) : (
        <div data-testid="match-stats">
          <div className={s.statsKpis}>
            <div>
              <b>{stats.rallies}</b>
              <span>{t("stats_rallies")}</span>
            </div>
            <div>
              <b>{stats.longestRally}</b>
              <span>{t("stats_longest")}</span>
            </div>
            <div>
              <b>{stats.fastestShotKmh != null ? `${stats.fastestShotKmh}` : "–"}</b>
              <span>{t("stats_fastest")} (km/h)</span>
            </div>
          </div>
          <table className={s.statsTable}>
            <thead>
              <tr>
                <th />
                <th>{t("stats_hits")}</th>
                <th>{t("stats_dist")}</th>
                <th>{t("stats_speed")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.players.map((p, i) => (
                <tr key={p.playerId}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[i], display: "inline-block" }} />
                      {names[i] ?? "Wolf"}
                    </span>
                  </td>
                  <td>{p.hits}</td>
                  <td>{p.distance.toFixed(1)} m</td>
                  <td>{p.topSpeed.toFixed(1)} m/s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
            {t("stats_by", { name: stats.recordedBy.name, mode: t(stats.mode === "live" ? "stats_mode_live" : "stats_mode_upload") })}
          </p>
        </div>
      )}
    </ModalShell>
  );
}
