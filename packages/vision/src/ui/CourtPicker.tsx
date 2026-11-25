"use client";

import { COURT, courtLandmarks, courtLines, landmarkId, type CourtTap, type Pt } from "../match-analyzer";

/** The four outer corners, asked for first: near baseline left, right, then far right, far left. */
export const DEFAULT_CORNERS: Pt[] = [
  { x: 0, y: 0 },
  { x: COURT.width, y: 0 },
  { x: COURT.width, y: COURT.length },
  { x: 0, y: COURT.length },
];

const X_NAMES = {
  en: ["left sideline", "left singles sideline", "centre line", "right singles sideline", "right sideline"],
  vi: ["biên dọc trái", "biên đơn trái", "vạch giữa", "biên đơn phải", "biên dọc phải"],
};
const Y_NAMES = {
  en: ["near baseline", "near long service line", "near short service line", "net", "far short service line", "far long service line", "far baseline"],
  vi: ["biên cuối gần", "vạch giao cầu dài gần", "vạch giao cầu ngắn gần", "lưới", "vạch giao cầu ngắn xa", "vạch giao cầu dài xa", "biên cuối xa"],
};
const XS = [0, COURT.singlesInset, COURT.width / 2, COURT.width - COURT.singlesInset, COURT.width];
const YS = [0, COURT.longServiceDoubles, COURT.net - COURT.shortService, COURT.net, COURT.net + COURT.shortService, COURT.length - COURT.longServiceDoubles, COURT.length];

/** Plain words for a court point, used in the "tap the …" prompt. */
export function describePoint(p: Pt, lang: "en" | "vi"): string {
  const xi = XS.findIndex((x) => Math.abs(x - p.x) < 0.01);
  const yi = YS.findIndex((y) => Math.abs(y - p.y) < 0.01);
  if (xi < 0 || yi < 0) return lang === "vi" ? "điểm đã chọn" : "chosen point";
  const corner = (xi === 0 || xi === 4) && (yi === 0 || yi === 6);
  if (lang === "vi") {
    if (yi === 3) return `chân cột lưới ${xi === 0 ? "trái" : "phải"}`;
    if (corner) return `góc ${yi === 0 ? "gần" : "xa"} ${xi === 0 ? "trái" : "phải"} (ngoài cùng)`;
    return `giao điểm ${X_NAMES.vi[xi]} và ${Y_NAMES.vi[yi]}`;
  }
  if (yi === 3) return `${xi === 0 ? "left" : "right"} net post foot`;
  if (corner) return `${yi === 0 ? "near" : "far"}-${xi === 0 ? "left" : "right"} outer corner`;
  return `point where the ${X_NAMES.en[xi]} meets the ${Y_NAMES.en[yi]}`;
}

/**
 * A tappable court diagram (camera at the bottom). Shows which points are
 * placed, highlights the one the next video tap will set, and lets the
 * assistant choose any visible line crossing instead.
 */
export function CourtPicker({ taps, target, onPick, compact = false }: { taps: CourtTap[]; target: Pt | null; onPick: (p: Pt) => void; compact?: boolean }) {
  const pad = 0.9;
  const W = COURT.width + pad * 2;
  const L = COURT.length + pad * 2;
  // Court y runs away from the camera, so it is drawn upwards.
  const sx = (x: number) => x + pad;
  const sy = (y: number) => COURT.length - y + pad;
  const placed = new Map(taps.map((t, i) => [landmarkId(t.court), i + 1]));
  const targetId = target ? landmarkId(target) : null;
  return (
    <svg viewBox={`0 0 ${W} ${L + 0.8}`} style={compact ? { height: "100%", width: "auto", display: "block" } : { height: 300, width: "auto", maxWidth: "100%", display: "block", margin: "0 auto" }} role="group" aria-label="Court points">
      <rect x={sx(0)} y={sy(COURT.length)} width={COURT.width} height={COURT.length} fill="#14532d" opacity={0.55} />
      {courtLines().map((seg, i) => (
        <line
          key={i}
          x1={sx(seg.a.x)}
          y1={sy(seg.a.y)}
          x2={sx(seg.b.x)}
          y2={sy(seg.b.y)}
          stroke={seg.dashed ? "#e2e8f0" : "#f8fafc"}
          strokeWidth={seg.dashed ? 0.06 : 0.05}
          strokeDasharray={seg.dashed ? "0.25 0.18" : undefined}
        />
      ))}
      {courtLandmarks().map((lm) => {
        const n = placed.get(lm.id);
        const isTarget = lm.id === targetId;
        return (
          <g key={lm.id} onClick={() => onPick(lm.p)} style={{ cursor: "pointer" }} data-testid={`lm-${lm.id}`}>
            <circle cx={sx(lm.p.x)} cy={sy(lm.p.y)} r={0.42} fill="transparent" />
            <circle
              cx={sx(lm.p.x)}
              cy={sy(lm.p.y)}
              r={isTarget ? 0.3 : n ? 0.27 : 0.16}
              fill={isTarget ? "#facc15" : n ? "#0e2c3f" : "#94a3b8"}
              stroke={isTarget || n ? "#facc15" : "none"}
              strokeWidth={0.07}
            >
              {isTarget ? <animate attributeName="r" values="0.24;0.36;0.24" dur="1.2s" repeatCount="indefinite" /> : null}
            </circle>
            {n ? (
              <text x={sx(lm.p.x)} y={sy(lm.p.y) + 0.11} fontSize={0.32} textAnchor="middle" fill="#fff" fontWeight={800} pointerEvents="none">
                {n}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x={W / 2} y={L + 0.55} fontSize={0.42} textAnchor="middle" fill="#b4ccd9">
        📷
      </text>
    </svg>
  );
}
