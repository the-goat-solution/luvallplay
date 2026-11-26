// A game's tracked stats, from the feed's "Stats" chip, as the website's
// window: rallies, the longest, the fastest shot, then each player's hits,
// distance and top speed, and who recorded it.
import { Dialog } from "../../components/Dialog.tsx";
import { useMatchStats } from "./data.ts";
import type { ArenaT } from "./words.ts";
import { MatchReport } from "../../components/MatchReport.tsx";

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
          <MatchReport stats={stats} names={names} t={t} />
          <p className="muted small">{t("stats_by", { name: stats.recordedBy.name, mode: t(stats.mode === "live" ? "stats_mode_live" : "stats_mode_upload") })}</p>
        </div>
      )}
      <div><button type="button" className="button button-quiet" onClick={onClose}>{t("card_close")}</button></div>
    </Dialog>
  );
}
