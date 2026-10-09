"use client";

import { useState } from "react";
import { formatCents, monthLabel } from "@/lib/finance";
import styles from "./financials.module.css";

type Month = { month: string; receivedCents: number; spentCents: number };

// Series colours: categorical slots 1 and 2 of the validated chart palette
// (blue / orange) rather than green / red, which collapse for deuteranopes.
// Identity is never colour-alone: a legend, fixed left/right order within
// each month, the tooltip and the table view all carry it too.
const RECEIVED = "#2a78d6";
const SPENT = "#eb6834";
const NET = "#1a2a4a";
const GRID = "#e6e7ea";
const SURFACE = "#ffffff";

const W = 760;
const H = 260;
const PAD = { top: 16, right: 12, bottom: 28, left: 56 };

// Clean axis steps: 1, 2, 2.5 or 5 × a power of ten.
function niceStep(range: number, targetTicks = 4): number {
  if (range <= 0) return 1;
  const raw = range / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

function compactDollars(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  const sign = d < 0 ? "−" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Columns open upward from the baseline with a 4px rounded data end and a
// square foot; a downward column (never used here) isn't needed.
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function MonthlyChart({ months, title }: { months: Month[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const nets = months.map((m) => m.receivedCents - m.spentCents);
  const maxVal = Math.max(0, ...months.map((m) => Math.max(m.receivedCents, m.spentCents)), ...nets);
  const minVal = Math.min(0, ...nets);
  const step = niceStep(maxVal - minVal || 10000);
  const top = Math.ceil(maxVal / step) * step || step;
  const bottom = Math.floor(minVal / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * plotH;
  const band = plotW / months.length;
  const barW = Math.max(3, Math.min(24, (band - 10) / 2 - 1));
  const center = (i: number) => PAD.left + band * i + band / 2;
  const zeroY = y(0);

  const netPoints = nets.map((n, i) => `${center(i)},${y(n)}`).join(" ");
  const everyNth = months.length > 12 ? 2 : 1;
  const active = hover !== null ? months[hover] : null;

  return (
    <section className={styles.chartCard} aria-label={title}>
      <div className={styles.chartHead}>
        <span className={styles.cardTitle}>{title}</span>
        <div className={styles.legend}>
          <span><i className={styles.swatch} style={{ background: RECEIVED }} />Received</span>
          <span><i className={styles.swatch} style={{ background: SPENT }} />Spent</span>
          <span><i className={styles.lineKey} style={{ background: NET }} />Net</span>
        </div>
      </div>

      <div className={styles.chartArea} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label={`${title}: received, spent and net by month. A table view follows.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c9ccd2" : GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className={styles.axisText}>
                {compactDollars(t)}
              </text>
            </g>
          ))}

          {months.map((m, i) => {
            const cx = center(i);
            const recH = zeroY - y(m.receivedCents);
            const spH = zeroY - y(m.spentCents);
            const dim = hover !== null && hover !== i;
            return (
              <g key={m.month} opacity={dim ? 0.45 : 1}>
                <path d={columnPath(cx - barW - 1, y(m.receivedCents), barW, recH)} fill={RECEIVED} />
                <path d={columnPath(cx + 1, y(m.spentCents), barW, spH)} fill={SPENT} />
                {i % everyNth === 0 || i === months.length - 1 ? (
                  <text x={cx} y={H - 8} textAnchor="middle" className={styles.axisText}>
                    {monthLabel(m.month)}
                    {m.month.endsWith("-01") || i === 0 ? ` ${m.month.slice(2, 4)}` : ""}
                  </text>
                ) : null}
              </g>
            );
          })}

          <polyline points={netPoints} fill="none" stroke={NET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {nets.map((n, i) => (
            <circle key={i} cx={center(i)} cy={y(n)} r={hover === i ? 5 : 4} fill={NET} stroke={SURFACE} strokeWidth={2} />
          ))}

          {/* Full-height hit targets, one per month — wider than the marks. */}
          {months.map((m, i) => (
            <rect
              key={`hit-${m.month}`}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${monthLabel(m.month, { year: true })}: received ${formatCents(m.receivedCents)}, spent ${formatCents(m.spentCents)}, net ${formatCents(nets[i], { signed: true })}`}
            />
          ))}
        </svg>

        {active && hover !== null ? (
          <div
            className={styles.tooltip}
            style={{
              left: `${(center(hover) / W) * 100}%`,
              transform: hover > months.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <strong>{monthLabel(active.month, { year: true })}</strong>
            <span><i className={styles.swatch} style={{ background: RECEIVED }} />Received <b className={styles.num}>{formatCents(active.receivedCents)}</b></span>
            <span><i className={styles.swatch} style={{ background: SPENT }} />Spent <b className={styles.num}>{formatCents(active.spentCents)}</b></span>
            <span><i className={styles.lineKey} style={{ background: NET }} />Net <b className={styles.num}>{formatCents(nets[hover], { signed: true })}</b></span>
          </div>
        ) : null}
      </div>

      <details className={styles.chartTable}>
        <summary>View as table</summary>
        <table className={styles.breakdownTable}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Received</th>
              <th>Spent</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month, { year: true })}</td>
                <td className={styles.num}>{formatCents(m.receivedCents)}</td>
                <td className={styles.num}>{formatCents(m.spentCents)}</td>
                <td className={styles.num}>{formatCents(nets[i], { signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
