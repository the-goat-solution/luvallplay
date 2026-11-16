"use client";

import Link from "next/link";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { LeaderboardRow, Metric, Period, PeriodRange } from "@/lib/stats-db";
import s from "./leaderboard.module.css";

const PERIOD_LABEL: Record<Period, ProfileKey> = {
  month: "lb_month",
  quarter: "lb_quarter",
  year: "lb_year",
  lifetime: "lb_lifetime",
};

function rangeTitle(range: PeriodRange, lang: string, allTime: string): string {
  if (range.period === "lifetime" || !range.start) return allTime;
  if (range.period === "year") return range.key;
  if (range.period === "quarter") return range.key.replace("-", " ").replace(/^(\d{4}) (Q\d)$/, "$2 $1");
  return new Date(`${range.start}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export function LeaderboardView({
  metric,
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
}: {
  metric: Metric;
  period: Period;
  range: PeriodRange;
  rows: LeaderboardRow[];
  prevKey: string | null;
  nextKey: string | null;
  isCurrent: boolean;
  meId: number | null;
  meVisible: boolean;
  hiddenRank: number | null;
  signedIn: boolean;
  justHidden: boolean;
}) {
  const { tr, lang } = useProfileT();
  const href = (m: Metric, p: Period, key?: string | null) =>
    `/leaderboard?metric=${m}&period=${p}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  const value = (r: LeaderboardRow) => (metric === "rr" ? tr("lb_pts", { n: r.value }) : r.value === 1 ? tr("lb_day") : tr("lb_days", { n: r.value }));
  const meta = (r: LeaderboardRow) => (metric === "rr" ? tr("lb_rr_meta", { w: r.wins ?? 0, d: (r.diff ?? 0) > 0 ? `+${r.diff}` : String(r.diff ?? 0) }) : "");

  const top = rows.slice(0, 3);
  const rest = rows.slice(3, 20);
  const me = meId ? rows.find((r) => r.playerId === meId) : undefined;
  const pinMe = me && me.rank > 20;
  // Podium order: 2nd, 1st, 3rd.
  const podium = [top[1], top[0], top[2]].filter(Boolean) as LeaderboardRow[];

  return (
    <main className={s.page}>
      <header className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.eyebrow}>Three Wolves</div>
          <h1 className={s.title}>{tr("lb_title")}</h1>
          <p className={s.sub}>{tr("lb_sub")}</p>
          <div className={s.metricToggle} role="tablist" aria-label={tr("lb_title")}>
            {(["attendance", "rr"] as const).map((m) => (
              <Link key={m} href={href(m, period, isCurrent ? null : range.key)} role="tab" aria-selected={metric === m} className={metric === m ? s.on : undefined} scroll={false}>
                {tr(m === "attendance" ? "lb_attendance" : "lb_rr")}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <div className={s.body}>
        {justHidden && <div className={s.note}>{tr("lb_hidden_ok")}</div>}
        {signedIn && !meVisible && hiddenRank && <div className={s.note}>{tr("lb_hidden_self", { rank: hiddenRank })}</div>}

        <nav className={s.periods} aria-label="Period">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <Link key={p} href={href(metric, p)} className={period === p ? s.on : undefined} aria-current={period === p ? "page" : undefined} scroll={false}>
              {tr(PERIOD_LABEL[p])}
            </Link>
          ))}
        </nav>

        <div className={s.stepper}>
          {prevKey ? (
            <Link href={href(metric, period, prevKey)} aria-label={tr("lb_prev")} className={s.stepBtn} scroll={false}>
              ‹
            </Link>
          ) : (
            <span className={s.stepBtn} aria-hidden="true" />
          )}
          <h2>{rangeTitle(range, lang, tr("lb_lifetime"))}</h2>
          {nextKey ? (
            <Link href={href(metric, period, nextKey)} aria-label={tr("lb_next")} className={s.stepBtn} scroll={false}>
              ›
            </Link>
          ) : (
            <span className={s.stepBtn} aria-hidden="true" />
          )}
        </div>

        {rows.length === 0 ? (
          <p className={s.empty}>{tr("lb_empty")}</p>
        ) : (
          <>
            <ol className={s.podium} aria-label="Top 3">
              {podium.map((r) => (
                <li key={r.playerId} className={`${s.place} ${s[`p${r.rank}`] ?? ""} ${r.playerId === meId ? s.mine : ""}`}>
                  <div className={s.avatar}>{r.initials}</div>
                  <div className={s.podName}>{r.name}</div>
                  <div className={s.podValue}>{value(r)}</div>
                  <div className={s.block}>
                    <span>{r.rank}</span>
                  </div>
                </li>
              ))}
            </ol>

            {rest.length > 0 && (
              <ol className={s.list} start={4}>
                {rest.map((r) => (
                  <li key={r.playerId} className={r.playerId === meId ? s.mine : undefined}>
                    <span className={s.rank}>{r.rank}</span>
                    <span className={s.smallAvatar}>{r.initials}</span>
                    <span className={s.name}>
                      {r.name}
                      {r.playerId === meId && <em> · {tr("lb_you")}</em>}
                      {meta(r) && <small>{meta(r)}</small>}
                    </span>
                    <span className={s.value}>{value(r)}</span>
                  </li>
                ))}
              </ol>
            )}
            {pinMe && me && (
              <ol className={`${s.list} ${s.pinned}`}>
                <li className={s.mine}>
                  <span className={s.rank}>{me.rank}</span>
                  <span className={s.smallAvatar}>{me.initials}</span>
                  <span className={s.name}>
                    {me.name} <em>· {tr("lb_you")}</em>
                  </span>
                  <span className={s.value}>{value(me)}</span>
                </li>
              </ol>
            )}
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
