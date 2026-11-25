// "Wolf Vision": the Match Analyzer's broadcast overlay, in the Arena's night-
// court style (coral vs teal corners, floodlight yellow for the shuttle and
// highlights, navy glass panels, Copperplate for the brand). Drawn in video
// pixels on top of the camera frame; the caller sets the canvas transform.
import { COURT, courtLines, formatClock, type Box, type Pt, type RallyReadout } from "../match-analyzer";
import { courtToImage, projectSegment, type CourtCamera } from "../engine/lens";
import type { Hit } from "../engine/hits";
import type { QualityFactors } from "../engine/quality";
import type { ShuttlePoint } from "../engine/shuttle";

/** Posting pair: coral + soft coral; accepting pair: teal + soft teal (the Arena's two corners). */
export const PLAYER_COLORS = ["#ff6b57", "#ffb4a6", "#2fd4b5", "#a4f2e2"];
const FLOOD = "#ffd54a";
const BRONZE = "#c4892a";
const NIGHT = "rgba(8, 19, 31, 0.82)";
const NIGHT_SOFT = "rgba(13, 32, 51, 0.72)";
const STEEL = "rgba(180, 204, 217, 0.85)";
const SANS = "Montserrat, system-ui, -apple-system, Segoe UI, sans-serif";
const DISPLAY = "Copperplate, 'Copperplate Gothic Light', Montserrat, serif";

export type OverlayPlayer = {
  name: string;
  color: string;
  team: 0 | 1;
  pos: Pt | null;
  box: Box | null;
  conf: number;
  tracked: boolean;
  hits: number;
  distance: number;
  topSpeed: number;
  speed: number;
};

export type OverlayState = {
  cam: CourtCamera | null;
  t: number;
  players: OverlayPlayer[];
  rally: RallyReadout | null;
  teams: [string, string];
  shuttle: ShuttlePoint[];
  hits: Hit[];
  quality: { q: number; factors: QualityFactors; threshold: number; recall: number; audio?: boolean } | null;
  /** Frame rates (camera, analysed, detector), whether the detector is slowed down, and which AI layers run. */
  perf?: { camera: number | null; analysed: number; detector: number; throttled: boolean; ai: string[] };
  estimate: { seen: number; predicted: number; estimated: number; plusMinus: number } | null;
  waiting: number;
  /** Corner taps while calibrating. */
  calibration?: { taps: Pt[]; selected?: number } | null;
  /** Untagged people (when the assistant is fixing identities). */
  untagged?: Box[];
  logo?: CanvasImageSource | null;
  show: { hud: boolean; cards: boolean; players: boolean; map: boolean; system: boolean };
};

const f = (w: number, s: number, fam = SANS, italic = false) => `${italic ? "italic " : ""}${w} ${Math.round(s)}px ${fam}`;

function spaced(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Glass panel with a cut corner (top-right) and a thin coloured edge. */
function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, accent: string) {
  const c = 14 * u;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, NIGHT);
  g.addColorStop(1, NIGHT_SOFT);
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 16 * u;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 4 * u, h);
  ctx.restore();
}

function upper(s: string) {
  return s.toLocaleUpperCase("vi");
}

export function drawOverlay(ctx: CanvasRenderingContext2D, vw: number, vh: number, st: OverlayState) {
  const landscape = vw >= vh * 1.15;
  const u = landscape ? vh / 1080 : vw / 1080;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  if (st.cam && st.calibration) drawCourtLines(ctx, st.cam, u);
  if (st.calibration) drawTaps(ctx, st.calibration, u);
  if (st.cam && st.show.players) {
    drawRings(ctx, st, u);
    drawShuttle(ctx, st.shuttle, st.t, u);
    drawHitBursts(ctx, st, u);
    drawBrackets(ctx, st, u);
  }
  if (st.untagged?.length) drawUntagged(ctx, st.untagged, u);
  const m = 28 * u;
  let hudBottom = m;
  if (st.show.hud) hudBottom = drawHud(ctx, st, m, m, u);
  if (st.show.cards) {
    if (landscape) drawCards(ctx, st.players, vw - m - 560 * u, m, 560 * u, u);
    else drawCards(ctx, st.players, m, hudBottom + 14 * u, vw - 2 * m, u, true);
  }
  if (st.show.map && st.cam) drawMap(ctx, st, vw - m - 400 * u, vh - m - 240 * u, 400 * u, 240 * u, u);
  if (st.show.system && st.quality) drawSystem(ctx, st, m, vh - m - 270 * u, 360 * u, 270 * u, u);
  if (st.waiting > 0 && st.show.players) drawAcquiring(ctx, vw, vh, st, u);
  ctx.restore();
}

// ── Players ───────────────────────────────────────────────────────────────

function drawRings(ctx: CanvasRenderingContext2D, st: OverlayState, u: number) {
  const cam = st.cam!;
  st.players.forEach((p) => {
    if (!p.pos) return;
    const ring = (r: number) => {
      const pts: Pt[] = [];
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        pts.push(courtToImage(cam, { x: p.pos!.x + Math.cos(a) * r, y: p.pos!.y + Math.sin(a) * r }));
      }
      ctx.beginPath();
      pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 20 * u;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 5 * u;
    ring(0.48);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = p.color;
    ctx.fill();
    // Rotating tick marks: the "locked on" look; the arc length is the ID confidence.
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3 * u;
    const spin = st.t * 1.6;
    const pts: Pt[] = [];
    const span = Math.max(0.2, p.conf) * Math.PI * 2;
    for (let k = 0; k <= 28; k++) {
      const a = spin + (k / 28) * span;
      pts.push(courtToImage(cam, { x: p.pos!.x + Math.cos(a) * 0.66, y: p.pos!.y + Math.sin(a) * 0.66 }));
    }
    ctx.setLineDash([6 * u, 6 * u]);
    ctx.beginPath();
    pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });
}

/** First names on the tags, full names when two players share a first name. */
function tagLabel(st: OverlayState, p: OverlayPlayer): string {
  const first = (n: string) => n.split(" ")[0];
  const clash = st.players.filter((q) => first(q.name) === first(p.name)).length > 1;
  return upper(clash ? p.name : first(p.name));
}

function drawBrackets(ctx: CanvasRenderingContext2D, st: OverlayState, u: number) {
  const tags: { x: number; y: number; w: number; p: OverlayPlayer; label: string }[] = [];
  st.players.forEach((p) => {
    if (!p.box) return;
    const [x, y, w, h] = p.box;
    const c = Math.min(w, h) * 0.22;
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3 * u;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8 * u;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
      ctx.moveTo(cx + dx * c, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * c);
    }
    ctx.stroke();
    ctx.restore();
    ctx.font = f(800, 22 * u, SANS, true);
    spaced(ctx, 1.5 * u);
    const label = tagLabel(st, p);
    const tw = ctx.measureText(label).width;
    spaced(ctx, 0);
    tags.push({ x: x + w / 2, y: Math.max(40 * u, y - 18 * u), w: tw + 76 * u, p, label });
  });
  // Stack tags that would overlap (partners side by side).
  tags.sort((a, b) => b.y - a.y);
  const placed: { x: number; y: number; w: number }[] = [];
  for (const tg of tags) {
    let y = tg.y;
    for (let g = 0; g < 4; g++) {
      const hit = placed.find((r) => Math.abs(r.x - tg.x) < (r.w + tg.w) / 2 + 4 * u && Math.abs(r.y - y) < 36 * u);
      if (!hit) break;
      y = hit.y - 40 * u;
    }
    placed.push({ x: tg.x, y, w: tg.w });
    const x0 = tg.x - tg.w / 2;
    const h = 32 * u;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + 10 * u, y - h);
    ctx.lineTo(x0 + tg.w, y - h);
    ctx.lineTo(x0 + tg.w - 10 * u, y);
    ctx.lineTo(x0, y);
    ctx.closePath();
    ctx.fillStyle = NIGHT;
    ctx.fill();
    ctx.strokeStyle = tg.p.color;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.fillStyle = tg.p.color;
    ctx.font = f(800, 22 * u, SANS, true);
    spaced(ctx, 1.5 * u);
    ctx.fillText(tg.label, x0 + 16 * u, y - 9 * u);
    spaced(ctx, 0);
    ctx.font = f(700, 15 * u);
    ctx.fillStyle = STEEL;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(tg.p.conf * 100)}%`, x0 + tg.w - 16 * u, y - 10 * u);
    ctx.textAlign = "left";
    ctx.restore();
  }
}

function drawShuttle(ctx: CanvasRenderingContext2D, trail: ShuttlePoint[], t: number, u: number) {
  if (!trail.length) return;
  ctx.save();
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const age = t - b.t;
    ctx.globalAlpha = Math.max(0, 1 - age / 0.6);
    ctx.strokeStyle = FLOOD;
    ctx.lineWidth = 4 * u;
    ctx.shadowColor = FLOOD;
    ctx.shadowBlur = 10 * u;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const h = trail[trail.length - 1];
  if (t - h.t < 0.25) {
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = FLOOD;
    ctx.lineWidth = 2.5 * u;
    const r = 16 * u;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(h.x + dx * r * 0.55, h.y + dy * r * 0.55);
      ctx.lineTo(h.x + dx * r * 1.5, h.y + dy * r * 1.5);
    }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(h.x, h.y, 3.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHitBursts(ctx: CanvasRenderingContext2D, st: OverlayState, u: number) {
  for (const h of st.hits) {
    const age = st.t - h.t;
    if (age < 0 || age > 0.9) continue;
    const p = st.players[h.player];
    if (!p?.box) continue;
    const [x, y, w] = p.box;
    const cx = x + w / 2;
    const cy = y + 10 * u;
    const k = age / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = h.status === "accepted" ? FLOOD : STEEL;
    ctx.lineWidth = 4 * u;
    if (h.status === "predicted") ctx.setLineDash([8 * u, 8 * u]);
    ctx.beginPath();
    ctx.arc(cx, cy, (30 + 90 * k) * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = h.status === "accepted" ? `HIT · ${Math.round(h.p * 100)}%` : h.status === "inferred" ? `INFERRED · ${Math.round(h.p * 100)}%` : "PREDICTED";
    ctx.font = f(900, 26 * u, SANS, true);
    spaced(ctx, 2 * u);
    const tw = ctx.measureText(label).width;
    const lx = cx - tw / 2;
    const ly = cy - (70 + 30 * k) * u;
    ctx.fillStyle = h.status === "accepted" ? FLOOD : "rgba(8,19,31,0.85)";
    rr(ctx, lx - 12 * u, ly - 26 * u, tw + 24 * u, 36 * u, 6 * u);
    ctx.fill();
    ctx.fillStyle = h.status === "accepted" ? "#08131f" : FLOOD;
    ctx.fillText(label, lx, ly);
    spaced(ctx, 0);
    ctx.restore();
  }
}

function drawUntagged(ctx: CanvasRenderingContext2D, boxes: Box[], u: number) {
  ctx.save();
  for (const b of boxes) {
    ctx.setLineDash([10 * u, 8 * u]);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3 * u;
    ctx.strokeRect(b[0], b[1], b[2], b[3]);
  }
  ctx.restore();
}

function drawAcquiring(ctx: CanvasRenderingContext2D, vw: number, vh: number, st: OverlayState, u: number) {
  const found = st.players.length - st.waiting;
  const label = `ACQUIRING PLAYERS · ${found}/${st.players.length}`;
  ctx.save();
  ctx.font = f(900, 30 * u, SANS, true);
  spaced(ctx, 3 * u);
  const tw = ctx.measureText(label).width;
  const x = vw / 2 - tw / 2;
  const y = vh * 0.5;
  ctx.fillStyle = NIGHT;
  rr(ctx, x - 24 * u, y - 40 * u, tw + 48 * u, 58 * u, 8 * u);
  ctx.fill();
  ctx.fillStyle = FLOOD;
  ctx.fillText(label, x, y);
  // Scanning bar.
  const k = (st.t * 0.8) % 1;
  ctx.fillStyle = "rgba(255,213,74,0.25)";
  ctx.fillRect(x - 24 * u + (tw + 48 * u) * k - 30 * u, y + 12 * u, 60 * u, 4 * u);
  spaced(ctx, 0);
  ctx.restore();
}

// ── Panels ────────────────────────────────────────────────────────────────

function drawHud(ctx: CanvasRenderingContext2D, st: OverlayState, x: number, y: number, u: number): number {
  const r = st.rally;
  const w = 290 * u, h = 112 * u, gap = 10 * u;
  const cards = [
    { label: "RALLY", corner: r ? `${String(r.index + 1).padStart(2, "0")}/${String(r.total).padStart(2, "0")}` : "--", value: formatClock(r ? r.time : 0), unit: r?.live ? "LIVE" : "", accent: FLOOD },
    { label: "SHOTS", corner: "", value: String(r ? r.count : 0), unit: "IN RALLY", accent: PLAYER_COLORS[0] },
    { label: "SHOT SPEED", corner: "", value: r?.shotKmh != null ? String(Math.round(r.shotKmh)) : "–", unit: "KM/H", accent: PLAYER_COLORS[2] },
  ];
  cards.forEach((c, i) => {
    const cx = x + i * (w + gap);
    glass(ctx, cx, y, w, h, u, c.accent);
    ctx.fillStyle = STEEL;
    ctx.font = f(700, 16 * u);
    spaced(ctx, 3 * u);
    ctx.fillText(c.label, cx + 20 * u, y + 30 * u);
    if (c.corner) {
      ctx.textAlign = "right";
      ctx.fillStyle = FLOOD;
      ctx.fillText(c.corner, cx + w - 22 * u, y + 30 * u);
      ctx.textAlign = "left";
    }
    spaced(ctx, 0);
    ctx.fillStyle = "#fff";
    ctx.font = f(900, 54 * u, SANS, true);
    ctx.fillText(c.value, cx + 18 * u, y + 92 * u);
    if (c.unit) {
      ctx.textAlign = "right";
      ctx.fillStyle = c.unit === "LIVE" ? "#ff6b57" : STEEL;
      ctx.font = f(800, 14 * u);
      spaced(ctx, 2 * u);
      ctx.fillText(c.unit, cx + w - 18 * u, y + 92 * u);
      spaced(ctx, 0);
      ctx.textAlign = "left";
    }
  });
  // Brand strip under the HUD.
  ctx.save();
  ctx.font = f(700, 16 * u, DISPLAY);
  spaced(ctx, 4 * u);
  ctx.fillStyle = "rgba(226, 174, 96, 0.9)";
  if (st.logo) ctx.drawImage(st.logo, x, y + h + 10 * u, 26 * u, 26 * u);
  ctx.fillText("THREE WOLVES · WOLF VISION", x + (st.logo ? 34 : 0) * u, y + h + 30 * u);
  spaced(ctx, 0);
  ctx.restore();
  return y + h + 40 * u;
}

function drawCards(ctx: CanvasRenderingContext2D, players: OverlayPlayer[], x: number, y: number, w: number, u: number, twoCols = false) {
  const h = 80 * u, gap = 8 * u;
  const cols = twoCols ? 2 : 1;
  const cw = (w - gap * (cols - 1)) / cols;
  const maxD = Math.max(25, ...players.map((p) => p.distance * 1.15));
  players.forEach((p, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (h + gap);
    glass(ctx, cx, cy, cw, h, u, p.color);
    ctx.fillStyle = p.color;
    ctx.font = f(900, 26 * u, SANS, true);
    spaced(ctx, 1 * u);
    let name = upper(p.name);
    while (ctx.measureText(name).width > cw * 0.42 && name.length > 3) name = name.slice(0, -1);
    ctx.fillText(name, cx + 18 * u, cy + 34 * u);
    spaced(ctx, 0);
    // Stats on the right: hits and top speed.
    ctx.textAlign = "right";
    const right = cx + cw - 16 * u;
    ctx.fillStyle = "#fff";
    ctx.font = f(900, 26 * u, SANS, true);
    const sp = `${p.topSpeed.toFixed(1)}`;
    ctx.fillText(sp, right - 34 * u, cy + 34 * u);
    ctx.fillStyle = STEEL;
    ctx.font = f(700, 13 * u);
    ctx.fillText("M/S", right, cy + 34 * u);
    const spW = ctx.measureText("M/S").width;
    ctx.font = f(900, 26 * u, SANS, true);
    const spValW = ctx.measureText(sp).width;
    const hitsRight = right - 34 * u - spValW - 22 * u;
    ctx.fillStyle = FLOOD;
    ctx.fillText(String(p.hits), hitsRight, cy + 34 * u);
    const hw = ctx.measureText(String(p.hits)).width;
    ctx.fillStyle = STEEL;
    ctx.font = f(700, 13 * u);
    spaced(ctx, 2 * u);
    ctx.fillText("HITS", hitsRight - hw - 8 * u, cy + 34 * u);
    spaced(ctx, 0);
    ctx.textAlign = "left";
    void spW;
    // Distance: segmented bar.
    ctx.font = f(700, 12 * u);
    ctx.fillStyle = STEEL;
    spaced(ctx, 2 * u);
    ctx.fillText("MOVE", cx + 18 * u, cy + 63 * u);
    spaced(ctx, 0);
    const bx = cx + 72 * u, bw = cw - 72 * u - 90 * u, segs = 24, sw = bw / segs;
    const filled = Math.round(Math.min(1, p.distance / maxD) * segs);
    for (let s = 0; s < segs; s++) {
      ctx.fillStyle = s < filled ? p.color : "rgba(255,255,255,0.1)";
      ctx.fillRect(bx + s * sw, cy + 55 * u, sw - 2.5 * u, 8 * u);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = f(800, 15 * u);
    ctx.fillText(`${p.distance.toFixed(1)} m`, right, cy + 64 * u);
    ctx.textAlign = "left";
    if (!p.tracked) {
      ctx.fillStyle = "rgba(8,19,31,0.6)";
      ctx.fillRect(cx, cy, cw, h);
      ctx.fillStyle = STEEL;
      ctx.font = f(800, 13 * u);
      ctx.fillText("SEARCHING…", cx + cw / 2 - 40 * u, cy + h / 2 + 5 * u);
    }
  });
}

function drawSystem(ctx: CanvasRenderingContext2D, st: OverlayState, x: number, y: number, w: number, h: number, u: number) {
  const q = st.quality!;
  glass(ctx, x, y, w, h, u, BRONZE);
  ctx.font = f(800, 15 * u);
  spaced(ctx, 3 * u);
  ctx.fillStyle = "rgba(226,174,96,0.95)";
  ctx.fillText("AI-ENHANCED TRACKER", x + 20 * u, y + 28 * u);
  spaced(ctx, 0);
  if (st.perf?.ai.length) {
    ctx.font = f(700, 10 * u);
    ctx.fillStyle = "rgba(47,212,181,0.9)";
    spaced(ctx, 1 * u);
    ctx.fillText(st.perf.ai.join(" · "), x + 20 * u, y + 46 * u);
    spaced(ctx, 0);
  }
  // Quality gauge.
  const gx = x + 70 * u, gy = y + 122 * u, gr = 46 * u;
  ctx.lineWidth = 10 * u;
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.arc(gx, gy, gr, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  const col = q.q > 0.7 ? "#2fd4b5" : q.q > 0.45 ? FLOOD : "#ff6b57";
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 10 * u;
  ctx.beginPath();
  ctx.arc(gx, gy, gr, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * q.q));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.font = f(900, 30 * u, SANS, true);
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(q.q * 100)}`, gx, gy + 10 * u);
  ctx.font = f(700, 11 * u);
  ctx.fillStyle = STEEL;
  ctx.fillText("QUALITY", gx, gy + 28 * u);
  ctx.textAlign = "left";
  // Factors.
  const fx = x + 140 * u, fw = w - 160 * u;
  const rows: [string, number][] = [
    ["LIGHT", q.factors.light],
    ["STABILITY", q.factors.stability],
    ["COURT", q.factors.court],
    ["IDENTITY", q.factors.identity],
    ["RESOLUTION", q.factors.resolution],
  ];
  rows.forEach(([name, v], i) => {
    const ry = y + 66 * u + i * 22 * u;
    ctx.font = f(700, 11 * u);
    ctx.fillStyle = STEEL;
    spaced(ctx, 1.5 * u);
    ctx.fillText(name, fx, ry);
    spaced(ctx, 0);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(fx + 84 * u, ry - 8 * u, fw - 84 * u, 7 * u);
    ctx.fillStyle = v > 0.7 ? "#2fd4b5" : v > 0.45 ? FLOOD : "#ff6b57";
    ctx.fillRect(fx + 84 * u, ry - 8 * u, (fw - 84 * u) * Math.max(0, Math.min(1, v)), 7 * u);
  });
  const est = st.estimate;
  ctx.font = f(700, 12 * u);
  ctx.fillStyle = STEEL;
  ctx.fillText(`ACCEPT ≥ ${(q.threshold * 100).toFixed(0)}%   RECALL ≈ ${(q.recall * 100).toFixed(0)}%   SOUND ${q.audio === false ? "OFF" : "ON"}`, x + 20 * u, y + h - 40 * u);
  if (st.perf) {
    const pf = st.perf;
    ctx.font = f(700, 11 * u);
    ctx.fillStyle = pf.throttled ? FLOOD : STEEL;
    const cam = pf.camera ? `CAM ${Math.round(pf.camera)}` : "CAM –";
    ctx.fillText(`${cam} · ANALYSED ${Math.round(pf.analysed)} · DETECT ${Math.round(pf.detector)} FPS${pf.throttled ? " · THROTTLED" : ""}`, x + 20 * u, y + h - 62 * u);
  }
  if (est) {
    ctx.fillStyle = "#fff";
    ctx.font = f(800, 13 * u);
    ctx.fillText(`HITS ${est.seen + est.predicted}  (${est.predicted} PRED.)  EST. ${est.estimated} ± ${est.plusMinus}`, x + 20 * u, y + h - 18 * u);
  }
}

function drawMap(ctx: CanvasRenderingContext2D, st: OverlayState, x: number, y: number, w: number, h: number, u: number) {
  glass(ctx, x, y, w, h, u, FLOOD);
  ctx.font = f(800, 14 * u);
  spaced(ctx, 3 * u);
  ctx.fillStyle = "#fff";
  ctx.fillText("COURT MAP", x + 20 * u, y + 26 * u);
  spaced(ctx, 0);
  const px = x + 24 * u, py = y + 40 * u, pw = w - 44 * u, ph = h - 74 * u;
  const toMap = (p: Pt): Pt => ({ x: px + (p.y / COURT.length) * pw, y: py + (p.x / COURT.width) * ph });
  ctx.fillStyle = "rgba(47, 212, 181, 0.07)";
  ctx.fillRect(px, py, pw / 2, ph);
  ctx.fillStyle = "rgba(255, 107, 87, 0.07)";
  ctx.fillRect(px + pw / 2, py, pw / 2, ph);
  ctx.lineWidth = 1.4 * u;
  for (const seg of courtLines()) {
    const a = toMap(seg.a), b = toMap(seg.b);
    ctx.strokeStyle = seg.dashed ? FLOOD : "rgba(218,234,242,0.5)";
    ctx.setLineDash(seg.dashed ? [5 * u, 4 * u] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = f(800, 11 * u);
  spaced(ctx, 1.5 * u);
  ctx.fillStyle = STEEL;
  ctx.fillText(upper(st.teams[0]).slice(0, 18), px, y + h - 12 * u);
  ctx.textAlign = "right";
  ctx.fillText(upper(st.teams[1]).slice(0, 18), px + pw, y + h - 12 * u);
  ctx.textAlign = "left";
  spaced(ctx, 0);
  st.players.forEach((p) => {
    if (!p.pos) return;
    const q = toMap({ x: Math.min(COURT.width + 0.5, Math.max(-0.5, p.pos.x)), y: Math.min(COURT.length + 0.8, Math.max(-0.8, p.pos.y)) });
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12 * u;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 8 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ── Court set-up ─────────────────────────────────────────────────────────

function drawCourtLines(ctx: CanvasRenderingContext2D, cam: CourtCamera, u: number) {
  ctx.save();
  for (const seg of courtLines()) {
    const pts = projectSegment(cam, seg.a, seg.b);
    ctx.strokeStyle = seg.dashed ? "rgba(255,255,255,0.9)" : FLOOD;
    ctx.lineWidth = 3.5 * u;
    ctx.setLineDash(seg.dashed ? [12 * u, 10 * u] : []);
    ctx.beginPath();
    pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  ctx.restore();
}

function drawTaps(ctx: CanvasRenderingContext2D, cal: NonNullable<OverlayState["calibration"]>, u: number) {
  cal.taps.forEach((p, k) => {
    const r = (k === cal.selected ? 26 : 20) * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = k === cal.selected ? FLOOD : NIGHT;
    ctx.fill();
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = FLOOD;
    ctx.stroke();
    ctx.fillStyle = k === cal.selected ? "#08131f" : "#fff";
    ctx.font = f(900, 22 * u);
    ctx.textAlign = "center";
    ctx.fillText(String(k + 1), p.x, p.y + 8 * u);
    ctx.textAlign = "left";
  });
}
