// The Leaderboard tab (the Arena module's second tab), as on the website:
// one list of the club's points for a period (month, quarter, year, all
// time) from every source or one, with the tiers marked, your next tier,
// and a card for each player with a "Challenge" button.
import { useState, type CSSProperties } from "react";
import { ITEMS, LADDER, nextRank } from "@luvallplay/core/ranks";
import type { AppKey } from "@luvallplay/i18n/app";
import { useCurrentClub, useLang, useT } from "../hooks.tsx";
import { localeOf } from "../lib/format.ts";
import { useArenaT } from "./arena/words.ts";
import { useBoard, type Board, type BoardQuery, type BoardRow } from "./leaderboard/data.ts";
import { PlayerCard } from "./leaderboard/PlayerCard.tsx";
import { RankIcon } from "../components/RankIcon.tsx";
import { LoadError } from "../components/LoadError.tsx";
import { Meter, Stage } from "../components/Stage.tsx";
import { Icon } from "../components/Icon.tsx";

type Source = NonNullable<BoardQuery["source"]>;
type Period = NonNullable<BoardQuery["period"]>;
const SOURCES: [Source, AppKey][] = [["all", "lb_all"], ["challenges", "lb_ch"], ["play", "lb_attendance"], ["rr", "lb_rr"]];
const PERIODS: [Period, AppKey][] = [["month", "lb_month"], ["quarter", "lb_quarter"], ["year", "lb_ytd"], ["lifetime", "lb_lifetime"]];
const tierOf = (index: number) => LADDER[Math.max(0, Math.min(LADDER.length - 1, index))].item;
const tierStart = (index: number) => LADDER.find((r) => r.item === tierOf(index))!;

function rangeTitle(b: Board, t: ReturnType<typeof useT>, locale: string): string {
  const r = b.range;
  if (r.period === "lifetime" || !r.start) return t("lb_lifetime");
  if (r.period === "year") return b.isCurrent ? `${t("lb_ytd")} ${r.key}` : r.key;
  if (r.period === "quarter") return r.key.replace(/^(\d{4})-(Q\d)$/, "$2 $1");
  return new Date(`${r.start}T00:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", month: "long", year: "numeric" });
}

export default function LeaderboardScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const { rank } = useArenaT();
  const [q, setQ] = useState<BoardQuery>({ source: "all", period: "lifetime" });
  const [selected, setSelected] = useState<number | null>(null);
  const board = useBoard(q);
  const b = board.data;
  const locale = localeOf(lang, config?.club.country ?? "");

  const breakdown = (r: BoardRow) => {
    if (b?.source !== "all") return "";
    const parts: string[] = [];
    if (r.play) parts.push(r.play === 1 ? t("lb_day") : t("lb_days", { n: r.play }));
    if (r.rr) parts.push(t("lb_rr_part", { n: r.rr }));
    if (r.challenges) parts.push(r.challenges === 1 ? t("lb_ch_part1") : t("lb_ch_part", { n: r.challenges }));
    return parts.join(" · ");
  };
  const row = (r: BoardRow, mine: boolean, i = 0) => (
    <li key={`p${r.playerId}`} className={`board-row${mine ? " board-mine" : ""}${i < 12 ? " enter" : ""}`} style={{ "--i": i } as CSSProperties}>
      <button type="button" className="board-button" aria-haspopup="dialog" onClick={() => setSelected(r.playerId)}>
        <span className={`board-rank${r.rank <= 3 ? ` board-top${r.rank}` : ""}`}>{r.rank}</span>
        <span className="board-face">
          <span className="avatar avatar-small" aria-hidden="true">{r.avatarUrl ? <img src={r.avatarUrl} alt="" loading="lazy" /> : r.initials}</span>
          <RankIcon index={r.index} tarnished={r.tarnishing} px={22} className="board-face-rank" />
        </span>
        <span className="row-text">
          <span>
            <strong>{r.name}</strong>
            {mine && <em> · {t("lb_you")}</em>}
            {r.seat && (
              <span className="tag board-seat">
                <RankIcon index={r.index} seat={r.seat} px={16} />
                {t(r.seat === "alpha" ? "lb_alpha" : "lb_silver")}
              </span>
            )}
          </span>
          <span className="muted small">{[ITEMS[tierOf(r.index)][lang], breakdown(r)].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="board-value">{t("lb_wp_val", { n: r.value })}</span>
      </button>
    </li>
  );

  const shown = b?.rows.slice(0, 50) ?? [];
  const me = b?.rows.find((r) => r.playerId === b.me.id);
  const pinMe = me && !shown.includes(me);
  const tiersInOrder = shown.every((r, i) => i === 0 || r.index <= shown[i - 1].index);
  const next = b?.me.ladder ? nextRank(b.me.ladder.index) : null;

  const podium = shown.length >= 3 ? shown.slice(0, 3) : null;
  return (
    <Stage>
    <div className="screen leaderboard" data-screen="nav_leaderboard" data-state={b ? "ready" : board.isError ? "error" : "loading"}>
      <header className="stage-hero">
        {config && <p className="stage-kicker">{config.club.name}</p>}
        <h1>{t("lb_title")}</h1>
        <p className="lead">{t("lb_sub")}</p>
        <nav className="segmented" aria-label={t("lb_period")}>
          {PERIODS.map(([p, label]) => (
            <button key={p} type="button" aria-pressed={q.period === p} onClick={() => setQ({ source: q.source, period: p })}>{t(label)}</button>
          ))}
        </nav>
      </header>
      {board.isError && !b && <LoadError onRetry={() => void board.refetch()} />}
      {!b ? (
        !board.isError && <div className="skeleton skeleton-tall" aria-busy="true" />
      ) : (
        <div className="stack" aria-busy={board.isFetching}>
          {!b.me.visible && b.me.hiddenRank && <p className="notice">{t("lb_hidden_self", { rank: b.me.hiddenRank })}</p>}
          <div className="period-stepper">
            <button type="button" className="icon-button" aria-label={t("lb_prev")} disabled={!b.prevKey} onClick={() => setQ({ ...q, key: b.prevKey ?? undefined })}>‹</button>
            <h2>{rangeTitle(b, t, locale)}</h2>
            <button type="button" className="icon-button" aria-label={t("lb_next")} disabled={!b.nextKey} onClick={() => setQ({ ...q, key: b.nextKey ?? undefined })}>›</button>
          </div>
          {podium && (
            // The top three on a podium: a picture of the list's first rows, which stay the way to read and open them.
            <div className="top-three" aria-hidden="true" key={`${b.source}-${b.range.key}`}>
              {[podium[1], podium[0], podium[2]].map((r) => (
                <div key={r.playerId} className={`podium-place podium-${r.rank}`} onClick={() => setSelected(r.playerId)}>
                  {r.rank === 1 && <Icon name="crown" size={26} className="podium-crown" />}
                  <span className="podium-face">
                    {r.avatarUrl ? <img className="podium-disc" src={r.avatarUrl} alt="" /> : <span className="podium-disc">{r.initials}</span>}
                    <RankIcon index={r.index} tarnished={r.tarnishing} px={r.rank === 1 ? 30 : 24} className="podium-rank" />
                  </span>
                  <span className="podium-name">{r.name}</span>
                  <span className="podium-value">{t("lb_wp_val", { n: r.value })}</span>
                  <span className="podium-block"><span>{r.rank}</span></span>
                </div>
              ))}
            </div>
          )}
          <div className="stack-tight">
            <span className="muted small">{t("lb_points_from")}</span>
            <nav className="chips" aria-label={t("lb_points_from")}>
              {SOURCES.map(([s, label]) => (
                <button key={s} type="button" className="chip-button" aria-pressed={b.source === s} onClick={() => setQ({ ...q, source: s, key: b.isCurrent ? undefined : b.range.key })}>{t(label)}</button>
              ))}
            </nav>
          </div>
          {b.me.ladder && next && (
            <div className="card next-tier">
              <RankIcon index={next.index} px={48} />
              <span className="next-tier-text">
                <strong>{t("lb_next_tier", { tier: rank(next.index) })}</strong>
                <Meter
                  value={(b.me.ladder.wpTotal - LADDER[b.me.ladder.index].wp) / Math.max(1, next.wp - LADDER[b.me.ladder.index].wp)}
                  label={t("lb_next_tier", { tier: rank(next.index) })}
                />
                <span className="muted small">{t("lb_next_tier_to_go", { n: Math.max(1, next.wp - b.me.ladder.wpTotal), total: b.me.ladder.wpTotal })}</span>
              </span>
            </div>
          )}
          {b.rows.length === 0 ? (
            <p className="muted">{t("lb_empty")}</p>
          ) : (
            <>
              <ol className="board" key={`${b.source}-${b.range.key}`}>
                {shown.flatMap((r, i) => {
                  const out = [];
                  if (tiersInOrder && (i === 0 || tierOf(shown[i - 1].index) !== tierOf(r.index))) {
                    const start = tierStart(r.index);
                    out.push(
                      <li key={`tier${r.playerId}`} className="tier-line" aria-hidden="true">
                        <RankIcon index={start.index} px={22} />
                        <span>{ITEMS[start.item][lang]}</span>
                        <small>{start.wp > 0 ? t("lb_tier_from", { n: start.wp }) : t("lb_tier_start")}</small>
                      </li>,
                    );
                  }
                  out.push(row(r, r.playerId === b.me.id, i));
                  return out;
                })}
              </ol>
              {pinMe && me && <ol className="board board-pinned">{row(me, true)}</ol>}
            </>
          )}
          <p className="muted small">{t("lb_how")}</p>
        </div>
      )}
      {selected !== null && <PlayerCard id={selected} onClose={() => setSelected(null)} />}
    </div>
    </Stage>
  );
}
