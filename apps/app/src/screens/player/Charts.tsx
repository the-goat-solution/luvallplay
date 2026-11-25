// The Player tab's two small charts, plain SVG (no chart library): the last
// 26 weeks of play days, and round robin points per day.
import { useMemo } from "react";
import type { PlayerStats } from "./data.ts";

function weekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** One column a week, one row a weekday the club plays: played, missed (the club played), or no play day. */
export function Heatmap({ attended, clubDates, locale, labels }: { attended: string[]; clubDates: string[]; locale: string; labels: { title: string; on: string; miss: string; none: string } }) {
  const model = useMemo(() => {
    const end = weekKey(new Date().toISOString().slice(0, 10));
    const weeks: string[] = [];
    for (let i = 25; i >= 0; i--) {
      const d = new Date(`${end}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i * 7);
      weeks.push(d.toISOString().slice(0, 10));
    }
    const dows = [...new Set([...clubDates, ...attended].filter((d) => d >= weeks[0]).map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return { weeks, on: new Set(attended), club: new Set(clubDates), dows: dows.length ? dows : [5] };
  }, [attended, clubDates]);
  const cell = 14;
  const gap = 4;
  const left = 34;
  const width = left + model.weeks.length * (cell + gap);
  const height = model.dows.length * (cell + gap) + 18;
  const dayName = (dow: number) => new Date(Date.UTC(2026, 0, 4 + dow)).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  return (
    <figure className="heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={labels.title} preserveAspectRatio="xMinYMin meet">
        {model.dows.map((dow, r) => (
          <text key={dow} x={0} y={r * (cell + gap) + cell - 3} className="chart-axis">{dayName(dow)}</text>
        ))}
        {model.weeks.map((wk, c) =>
          model.dows.map((dow, r) => {
            const d = new Date(`${wk}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + ((dow + 6) % 7));
            const key = d.toISOString().slice(0, 10);
            const state = model.on.has(key) ? "on" : model.club.has(key) ? "miss" : "none";
            return (
              <rect key={`${wk}-${dow}`} x={left + c * (cell + gap)} y={r * (cell + gap)} width={cell} height={cell} rx={3} className={`cell-${state}`}>
                <title>{key}</title>
              </rect>
            );
          }),
        )}
        {model.weeks.map((wk, c) => {
          const d = new Date(`${wk}T00:00:00Z`);
          return d.getUTCDate() > 7 ? null : (
            <text key={wk} x={left + c * (cell + gap)} y={height - 2} className="chart-axis">
              {d.toLocaleDateString(locale, { month: "short", timeZone: "UTC" })}
            </text>
          );
        })}
      </svg>
      <figcaption className="chips small">
        <span><i className="swatch cell-on" /> {labels.on}</span>
        <span><i className="swatch cell-miss" /> {labels.miss}</span>
        <span><i className="swatch cell-none" /> {labels.none}</span>
      </figcaption>
    </figure>
  );
}

/** Round robin points per day, newest on the right. */
export function RrChart({ history, label }: { history: PlayerStats["rrHistory"]; label: string }) {
  const recent = history.slice(-16);
  const max = Math.max(4, ...recent.map((r) => r.points));
  const w = 320;
  const h = 120;
  const pad = 18;
  const step = recent.length > 1 ? (w - pad * 2) / (recent.length - 1) : 0;
  const pts = recent.map((r, i) => [pad + i * step, h - pad - (r.points / max) * (h - pad * 2)] as const);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="rr-chart" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="chart-baseline" />
      {pts.length > 1 && <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} className="chart-line" />}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x || w / 2} cy={y} r={4.5} className="chart-dot">
          <title>{`${recent[i].date}: ${recent[i].points}`}</title>
        </circle>
      ))}
    </svg>
  );
}
