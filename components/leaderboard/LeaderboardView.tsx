"use client";

import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { Period, PeriodRange } from "@/lib/stats-db";
import type { PointsBoardRow, PointsSource } from "@/lib/arena-db";
import { LADDER, ITEMS, nextRank, rankName, type Seat } from "@/lib/ranks";
import { RankIcon } from "@/components/arena/RankIcon";
import s from "./leaderboard.module.css";

const SOURCE_LABEL: Record<PointsSource, ProfileKey> = {
  all: "lb_all",
  challenges: "lb_ch",
  play: "lb_attendance",
  rr: "lb_rr",
};

const PERIOD_LABEL: Record<Period, ProfileKey> = {
  month: "lb_month",
  quarter: "lb_quarter",
  year: "lb_ytd",
  lifetime: "lb_lifetime",
};

export type MyLadder = { index: number; wpTotal: number };

function rangeTitle(range: PeriodRange, lang: string, allTime: string, isCurrent: boolean, ytd: string): string {
  if (range.period === "lifetime" || !range.start) return allTime;
  if (range.period === "year") return isCurrent ? `${ytd} ${range.key}` : range.key;
  if (range.period === "quarter") return range.key.replace("-", " ").replace(/^(\d{4}) (Q\d)$/, "$2 $1");
  return new Date(`${range.start}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** The tier a ladder position belongs to (the item: Plastic Shuttle … Diamond Racket). */
const tierOf = (index: number) => LADDER[Math.max(0, Math.min(LADDER.length - 1, index))].item;
const tierStart = (index: number) => LADDER.find((r) => r.item === tierOf(index))!;

export function LeaderboardView({
  source,
  period,
  range,
  rows,
  prevKey,
  nextKey,
  isCurrent,
  meId,
  meVisible,
  hiddenRank,
  signedIn,
  justHidden,
  myLadder,
}: {
  source: PointsSource;
  period: Period;
  range: PeriodRange;
  rows: PointsBoardRow[];
  prevKey: string | null;
  nextKey: string | null;
  isCurrent: boolean;
  meId: number | null;
  meVisible: boolean;
  hiddenRank: number | null;
  signedIn: boolean;
  justHidden: boolean;
  myLadder: MyLadder | null;
}) {
  const { tr, lang } = useProfileT();
  const href = (src: PointsSource, p: Period, key?: string | null) =>
    `/leaderboard?source=${src}&period=${p}${key ? `&key=${encodeURIComponent(key)}` : ""}`;

  const shown = rows.slice(0, 50);
  const me = meId ? rows.find((r) => r.playerId === meId) : undefined;
  const pinMe = me && !shown.includes(me);

  // Tier lines: drawn where the list steps down a tier. Only when the list
  // runs from the highest tier down (always so for All time + All points),
  // so a line never sits in the wrong place.
  const tiersInOrder = shown.every((r, i) => i === 0 || r.index <= shown[i - 1].index);
  const tierLine = (r: PointsBoardRow, i: number) => {
    if (!tiersInOrder) return null;
    if (i > 0 && tierOf(shown[i - 1].index) === tierOf(r.index)) return null;
    const start = tierStart(r.index);
    return (
      <li key={`tier-${r.playerId}`} className={s.tierLine} aria-hidden={i === 0 ? undefined : "true"}>
        <RankIcon index={start.index} px={22} />
        <span>{ITEMS[start.item][lang]}</span>
        <small>{start.wp > 0 ? tr("lb_tier_from", { n: start.wp }) : tr("lb_tier_start")}</small>
      </li>
    );
  };

  const breakdown = (r: PointsBoardRow) => {
    if (source !== "all") return "";
    const parts: string[] = [];
    if (r.play) parts.push(r.play === 1 ? tr("lb_day") : tr("lb_days", { n: r.play }));
    if (r.rr) parts.push(tr("lb_rr_part", { n: r.rr }));
    if (r.challenges) parts.push(r.challenges === 1 ? tr("lb_ch_part1") : tr("lb_ch_part", { n: r.challenges }));
    return parts.join(" · ");
  };

  const title = (seat: Seat | null) =>
    seat ? (
      <span className={`${s.wolfTitle} ${seat === "alpha" ? s.alpha : s.silver}`}>
        <RankIcon index={0} seat={seat} px={16} />
        {tr(seat === "alpha" ? "lb_alpha" : "lb_silver")}
      </span>
    ) : null;

  const row = (r: PointsBoardRow, mine: boolean) => (
    <li key={r.playerId} className={`${s.row} ${mine ? s.mine : ""} ${r.seat ? s.seated : ""}`}>
      <span className={`${s.rank} ${r.rank <= 3 ? s[`top${r.rank}`] : ""}`}>{r.rank}</span>
      <span className={s.who}>
        {r.avatarUrl ? <img src={r.avatarUrl} alt="" className={s.face} loading="lazy" /> : <span className={s.face}>{r.initials}</span>}
        <span className={s.faceRank} style={r.tarnishing ? { filter: "grayscale(.75)" } : undefined}>
          <RankIcon index={r.index} px={22} tarnished={r.tarnishing} />
        </span>
      </span>
      <span className={s.name}>
        <span className={s.nameLine}>
          {r.name}
          {mine && <em> · {tr("lb_you")}</em>}
          {title(r.seat)}
        </span>
        {breakdown(r) && <small>{breakdown(r)}</small>}
      </span>
      <span className={s.value}>{tr("lb_wp_val", { n: r.value })}</span>
    </li>
  );

  const next = myLadder ? nextRank(myLadder.index) : null;

  return (
    <main className={s.page}>
      <header className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.eyebrow}>Three Wolves</div>
          <h1 className={s.title}>{tr("lb_title")}</h1>
          <p className={s.sub}>{tr("lb_sub")}</p>
          <nav className={s.metricToggle} aria-label={tr("lb_period")}>
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <Link key={p} href={href(source, p)} className={period === p ? s.on : undefined} aria-current={period === p ? "page" : undefined} scroll={false}>
                <LinkPending>{tr(PERIOD_LABEL[p])}</LinkPending>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className={s.body}>
        {justHidden && <div className={s.note}>{tr("lb_hidden_ok")}</div>}
        {signedIn && !meVisible && hiddenRank && <div className={s.note}>{tr("lb_hidden_self", { rank: hiddenRank })}</div>}

        <div className={s.filterRow}>
          <span className={s.filterLabel}>{tr("lb_points_from")}</span>
          <nav className={s.sources} aria-label={tr("lb_points_from")}>
            {(Object.keys(SOURCE_LABEL) as PointsSource[]).map((src) => (
              <Link
                key={src}
                href={href(src, period, isCurrent ? null : range.key)}
                className={source === src ? s.on : undefined}
                aria-current={source === src ? "true" : undefined}
                scroll={false}
              >
                <LinkPending>{tr(SOURCE_LABEL[src])}</LinkPending>
              </Link>
            ))}
          </nav>
        </div>

        <div className={s.stepper}>
          {prevKey ? (
            <Link href={href(source, period, prevKey)} aria-label={tr("lb_prev")} className={s.stepBtn} scroll={false}>
              <LinkPending>‹</LinkPending>
            </Link>
          ) : (
            <span className={s.stepBtn} aria-hidden="true" />
          )}
          <h2>{rangeTitle(range, lang, tr("lb_lifetime"), isCurrent, tr("lb_ytd"))}</h2>
          {nextKey ? (
            <Link href={href(source, period, nextKey)} aria-label={tr("lb_next")} className={s.stepBtn} scroll={false}>
              <LinkPending>›</LinkPending>
            </Link>
          ) : (
            <span className={s.stepBtn} aria-hidden="true" />
          )}
        </div>

        {myLadder && next && (
          <div className={s.nextTier}>
            <RankIcon index={next.index} px={34} />
            <div>
              <strong>{tr("lb_next_tier", { tier: rankName(next, lang) })}</strong>
              <span>{tr("lb_next_tier_to_go", { n: Math.max(1, next.wp - myLadder.wpTotal), total: myLadder.wpTotal })}</span>
            </div>
            <div className={s.nextBar} aria-hidden="true">
              <i style={{ width: `${Math.round(Math.min(1, Math.max(0, (myLadder.wpTotal - LADDER[myLadder.index].wp) / (next.wp - LADDER[myLadder.index].wp))) * 100)}%` }} />
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <p className={s.empty}>{tr("lb_empty")}</p>
        ) : (
          <>
            <ol className={s.list}>{shown.flatMap((r, i) => [tierLine(r, i), row(r, r.playerId === meId)].filter(Boolean))}</ol>
            {pinMe && me && <ol className={`${s.list} ${s.pinned}`}>{row(me, true)}</ol>}
          </>
        )}

        {!signedIn && (
          <p className={s.cta}>
            <a href="/login?next=/leaderboard">{tr("lb_join_cta")} →</a>
          </p>
        )}
        <p className={s.how}>{tr("lb_how")}</p>
      </div>
    </main>
  );
}
