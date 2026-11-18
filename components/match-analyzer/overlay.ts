// Draws the broadcast-style overlay of the Match Analyzer onto a canvas:
// rally HUD (top left), player cards (top right), rings under the players'
// feet and name tags above them, and a top-down court map (bottom right).
// Everything is drawn in video pixels; the caller sets the canvas transform.
import {
  COURT,
  applyHomography,
  courtLines,
  floorCircle,
  formatClock,
  type Box,
  type Mat3,
  type Pt,
  type RallyReadout,
} from "@/lib/match-analyzer";

export const PLAYER_COLORS = ["#38bdf8", "#34d399", "#c084fc", "#fb923c"];

export type OverlayPlayer = {
  name: string;
  color: string;
  team: 0 | 1;
  /** Court position (metres), when tracked right now. */
  pos: Pt | null;
  /** Image box (video pixels), when tracked right now. */
  box: Box | null;
  hits: number;
  topSpeed: number;
  distance: number;
  /** Tagged by the court assistant at least once. */
  tagged: boolean;
};

export type OverlayState = {
  toImage: Mat3 | null;
  players: OverlayPlayer[];
  rally: RallyReadout | null;
  teams: [string, string];
  /** On-court people nobody has been matched to (shown while tagging). */
  untagged?: Box[];
  /** Corner taps while calibrating. */
  calibration?: { taps: Pt[]; selected?: number };
  /** Player who was just credited with a hit, and how many seconds ago. */
  flash?: { player: number; age: number } | null;
  /** Seconds recorded so far, when recording. */
  recording?: number | null;
  show: { hud: boolean; cards: boolean; rings: boolean; tags: boolean; map: boolean };
};

const FONT = "Montserrat, system-ui, -apple-system, Segoe UI, sans-serif";
const PANEL = "rgba(10, 22, 34, 0.84)";
const MUTED = "rgba(203, 220, 232, 0.72)";

function font(weight: number, size: number) {
  return `${weight} ${Math.round(size)}px ${FONT}`;
}

function spaced(ctx: CanvasRenderingContext2D, px: number) {
  // letterSpacing is a newer canvas feature; harmless where missing.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, accent: string) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12 * u;
  rrect(ctx, x, y, w, h, 10 * u);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = accent;
  rrect(ctx, x, y, 5 * u, h, 2.5 * u);
  ctx.fill();
}

function upper(name: string) {
  return name.toLocaleUpperCase("vi");
}

/** Shrinks text to fit a width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, size: number) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = font(weight, s);
  }
}

export function drawOverlay(ctx: CanvasRenderingContext2D, vw: number, vh: number, st: OverlayState) {
  const landscape = vw >= vh * 1.15;
  // Designed for 1920×1080; scaled to the real frame.
  const u = landscape ? vh / 1080 : vw / 1080;
  ctx.save();
  ctx.textBaseline = "alphabetic";

  if (st.toImage) {
    if (st.show.rings) drawRings(ctx, st, u);
    if (st.show.tags) drawTags(ctx, st, u);
  }
  if (st.untagged?.length) drawUntagged(ctx, st.untagged, u);
  if (st.calibration) drawCalibration(ctx, st.calibration, st.toImage, u);

  const m = 32 * u;
  let hudBottom = m;
  if (st.show.hud) hudBottom = drawHud(ctx, st.rally, m, m, u);
  if (st.show.cards) {
    if (landscape) drawCards(ctx, st.players, vw - m - 600 * u, m, 600 * u, u);
    else drawCards(ctx, st.players, m, hudBottom + 16 * u, vw - 2 * m, u, true);
  }
  if (st.show.map) drawMap(ctx, st, vw - m - 420 * u, vh - m - 250 * u, 420 * u, 250 * u, u);
  if (st.recording != null) drawRec(ctx, vw, st.recording, u, landscape ? m : vh - m - 50 * u);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, r: RallyReadout | null, x: number, y: number, u: number): number {
  const w = 300 * u, h = 112 * u, gap = 12 * u;
  const cards: { label: string; corner: string; value: string; unit: string; color: string }[] = [
    { label: "RALLY TIME", corner: r ? `#${r.index + 1}/${r.total}` : "", value: formatClock(r ? r.time : 0), unit: "", color: "#38bdf8" },
    { label: "RALLY COUNT", corner: "", value: String(r ? r.count : 0), unit: "SHOTS", color: "#2dd4bf" },
    { label: "SHOT SPEED", corner: "", value: r?.shotKmh != null ? String(Math.round(r.shotKmh)) : "–", unit: "km/h", color: "#fbbf24" },
  ];
  cards.forEach((c, i) => {
    const cx = x + i * (w + gap);
    panel(ctx, cx, y, w, h, u, c.color);
    ctx.fillStyle = MUTED;
    ctx.font = font(600, 19 * u);
    spaced(ctx, 2 * u);
    ctx.fillText(c.label, cx + 22 * u, y + 34 * u);
    if (c.corner) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.fillText(c.corner, cx + w - 16 * u, y + 34 * u);
      ctx.textAlign = "left";
    }
    spaced(ctx, 0);
    ctx.fillStyle = "#fff";
    ctx.font = font(800, 54 * u);
    ctx.fillText(c.value, cx + 20 * u, y + 94 * u);
    if (c.unit) {
      ctx.textAlign = "right";
      ctx.fillStyle = MUTED;
      ctx.font = font(600, 16 * u);
      ctx.fillText(c.unit, cx + w - 16 * u, y + 94 * u);
      ctx.textAlign = "left";
    }
  });
  return y + h;
}

function drawCards(ctx: CanvasRenderingContext2D, players: OverlayPlayer[], x: number, y: number, w: number, u: number, twoCols = false) {
  const h = 84 * u, gap = 10 * u;
  const cols = twoCols ? 2 : 1;
  const cw = (w - gap * (cols - 1)) / cols;
  const maxDist = Math.max(30, ...players.map((p) => p.distance * 1.1));
  players.forEach((p, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (h + gap);
    panel(ctx, cx, cy, cw, h, u, p.color);
    // Name, shrunk to fit.
    const statsW = 300 * u;
    ctx.fillStyle = p.color;
    fitText(ctx, upper(p.name), cw - statsW - 40 * u, 700, 30 * u);
    ctx.fillText(upper(p.name), cx + 22 * u, cy + 38 * u);
    // Hits and top speed.
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = font(800, 28 * u);
    const speed = p.topSpeed.toFixed(1);
    const right = cx + cw - 16 * u;
    ctx.font = font(600, 15 * u);
    const msW = ctx.measureText("m/s").width;
    ctx.fillStyle = MUTED;
    ctx.fillText("m/s", right, cy + 38 * u);
    ctx.font = font(800, 28 * u);
    ctx.fillStyle = "#fff";
    const speedRight = right - msW - 6 * u;
    ctx.fillText(speed, speedRight, cy + 38 * u);
    const speedW = ctx.measureText(speed).width;
    ctx.font = font(600, 15 * u);
    ctx.fillStyle = MUTED;
    spaced(ctx, 1.5 * u);
    const topLeft = speedRight - speedW - 10 * u;
    ctx.fillText("TOP SPEED", topLeft, cy + 38 * u);
    const topW = ctx.measureText("TOP SPEED").width;
    spaced(ctx, 0);
    ctx.font = font(800, 28 * u);
    ctx.fillStyle = "#fff";
    const hitsRight = topLeft - topW - 22 * u;
    ctx.fillText(String(p.hits), hitsRight, cy + 38 * u);
    const hitsW = ctx.measureText(String(p.hits)).width;
    ctx.font = font(600, 15 * u);
    ctx.fillStyle = MUTED;
    spaced(ctx, 1.5 * u);
    ctx.fillText("HITS", hitsRight - hitsW - 8 * u, cy + 38 * u);
    spaced(ctx, 0);
    ctx.textAlign = "left";

    // Movement bar.
    ctx.font = font(600, 14 * u);
    ctx.fillStyle = MUTED;
    spaced(ctx, 2 * u);
    ctx.fillText("MOVE", cx + 22 * u, cy + 68 * u);
    spaced(ctx, 0);
    const barX = cx + 92 * u;
    const barW = cw - 92 * u - 100 * u;
    const segs = 20;
    const segW = barW / segs;
    const filled = Math.round(Math.min(1, p.distance / maxDist) * segs);
    for (let s = 0; s < segs; s++) {
      ctx.fillStyle = s < filled ? p.color : "rgba(255,255,255,0.12)";
      ctx.fillRect(barX + s * segW, cy + 60 * u, segW - 3 * u, 7 * u);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.font = font(600, 15 * u);
    ctx.fillText(`${p.distance.toFixed(1)} m`, right, cy + 68 * u);
    ctx.textAlign = "left";
    if (!p.tagged) {
      ctx.fillStyle = "rgba(10,22,34,0.55)";
      rrect(ctx, cx, cy, cw, h, 10 * u);
      ctx.fill();
    }
  });
}

function drawRings(ctx: CanvasRenderingContext2D, st: OverlayState, u: number) {
  const H = st.toImage!;
  st.players.forEach((p, i) => {
    if (!p.pos) return;
    const ring = floorCircle(H, p.pos, 0.45);
    const inner = floorCircle(H, p.pos, 0.28);
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 22 * u;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 6 * u;
    path(ctx, ring);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5 * u;
    path(ctx, inner);
    ctx.stroke();
    // A pulse when this player was just credited with a hit.
    if (st.flash && st.flash.player === i && st.flash.age < 0.6) {
      const k = st.flash.age / 0.6;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 5 * u;
      path(ctx, floorCircle(H, p.pos, 0.45 + 0.9 * k));
      ctx.stroke();
    }
    ctx.restore();
  });
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
}

function drawTags(ctx: CanvasRenderingContext2D, st: OverlayState, u: number) {
  st.players.forEach((p) => {
    if (!p.box) return;
    const label = upper(p.name);
    ctx.font = font(700, 24 * u);
    spaced(ctx, 1 * u);
    const tw = ctx.measureText(label).width;
    spaced(ctx, 0);
    const w = tw + 30 * u, h = 40 * u;
    const cx = p.box[0] + p.box[2] / 2;
    const top = Math.max(4 * u, p.box[1] - h - 18 * u);
    const x = cx - w / 2;
    ctx.fillStyle = "rgba(14, 44, 63, 0.92)";
    rrect(ctx, x, top, w, h, 4 * u);
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.fillRect(x, top, 4 * u, h);
    ctx.beginPath();
    ctx.moveTo(cx - 9 * u, top + h);
    ctx.lineTo(cx + 9 * u, top + h);
    ctx.lineTo(cx, top + h + 10 * u);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.fillStyle = "#fff";
    spaced(ctx, 1 * u);
    ctx.fillText(label, x + 17 * u, top + 28 * u);
    spaced(ctx, 0);
  });
}

function drawUntagged(ctx: CanvasRenderingContext2D, boxes: Box[], u: number) {
  ctx.save();
  boxes.forEach((b) => {
    ctx.setLineDash([10 * u, 8 * u]);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3 * u;
    ctx.strokeRect(b[0], b[1], b[2], b[3]);
    ctx.setLineDash([]);
    const label = "TAP TO TAG";
    ctx.font = font(700, 18 * u);
    const w = ctx.measureText(label).width + 16 * u;
    const x = b[0] + b[2] / 2 - w / 2;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    rrect(ctx, x, b[1] - 34 * u, w, 28 * u, 4 * u);
    ctx.fill();
    ctx.fillStyle = "#0e2c3f";
    ctx.fillText(label, x + 8 * u, b[1] - 14 * u);
  });
  ctx.restore();
}

function drawCalibration(ctx: CanvasRenderingContext2D, cal: NonNullable<OverlayState["calibration"]>, toImage: Mat3 | null, u: number) {
  ctx.save();
  if (toImage) {
    for (const seg of courtLines()) {
      const a = applyHomography(toImage, seg.a);
      const b = applyHomography(toImage, seg.b);
      ctx.strokeStyle = seg.dashed ? "rgba(255,255,255,0.9)" : "rgba(250, 204, 21, 0.95)";
      ctx.lineWidth = (seg.dashed ? 3 : 3.5) * u;
      ctx.setLineDash(seg.dashed ? [12 * u, 10 * u] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else if (cal.taps.length > 1) {
    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    cal.taps.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  cal.taps.forEach((p, k) => {
    const r = (k === cal.selected ? 26 : 20) * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = k === cal.selected ? "rgba(250, 204, 21, 0.95)" : "rgba(14, 44, 63, 0.9)";
    ctx.fill();
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = "#facc15";
    ctx.stroke();
    ctx.fillStyle = k === cal.selected ? "#0e2c3f" : "#fff";
    ctx.font = font(800, 22 * u);
    ctx.textAlign = "center";
    ctx.fillText(String(k + 1), p.x, p.y + 8 * u);
    ctx.textAlign = "left";
  });
  ctx.restore();
}

function drawMap(ctx: CanvasRenderingContext2D, st: OverlayState, x: number, y: number, w: number, h: number, u: number) {
  panel(ctx, x, y, w, h, u, "#38bdf8");
  ctx.font = font(600, 16 * u);
  ctx.fillStyle = "#fff";
  spaced(ctx, 2 * u);
  ctx.fillText("COURT MAP", x + 22 * u, y + 30 * u);
  ctx.textAlign = "right";
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 12 * u);
  ctx.fillText("PLAYER POSITIONS", x + w - 16 * u, y + 30 * u);
  ctx.textAlign = "left";
  spaced(ctx, 0);

  // The court lies on its side: along the court is left → right.
  const px = x + 28 * u, py = y + 46 * u, pw = w - 50 * u, ph = h - 84 * u;
  const toMap = (p: Pt): Pt => ({ x: px + (p.y / COURT.length) * pw, y: py + (p.x / COURT.width) * ph });
  ctx.lineWidth = 1.5 * u;
  for (const seg of courtLines()) {
    const a = toMap(seg.a), b = toMap(seg.b);
    ctx.strokeStyle = seg.dashed ? "rgba(255,255,255,0.75)" : "rgba(218, 234, 242, 0.55)";
    ctx.setLineDash(seg.dashed ? [5 * u, 4 * u] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = font(600, 12 * u);
  spaced(ctx, 1.5 * u);
  ctx.fillStyle = MUTED;
  const [near, far] = st.teams;
  ctx.fillText(upper(near).slice(0, 22), px, y + h - 14 * u);
  ctx.textAlign = "right";
  ctx.fillText(upper(far).slice(0, 22), px + pw, y + h - 14 * u);
  ctx.textAlign = "left";
  spaced(ctx, 0);

  st.players.forEach((p) => {
    if (!p.pos) return;
    const q = toMap({
      x: Math.min(COURT.width + 0.6, Math.max(-0.6, p.pos.x)),
      y: Math.min(COURT.length + 0.8, Math.max(-0.8, p.pos.y)),
    });
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12 * u;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 9 * u, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(q.x, q.y, 9 * u, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  });
}

function drawRec(ctx: CanvasRenderingContext2D, vw: number, seconds: number, u: number, y: number) {
  const label = `REC ${formatClock(seconds).slice(0, 5)}`;
  ctx.font = font(700, 22 * u);
  const w = ctx.measureText(label).width + 52 * u;
  const x = vw / 2 - w / 2;
  ctx.fillStyle = "rgba(10,22,34,0.8)";
  rrect(ctx, x, y, w, 44 * u, 22 * u);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 22 * u, y + 22 * u, 8 * u, 0, Math.PI * 2);
  ctx.fillStyle = Math.floor(seconds * 2) % 2 ? "#ef4444" : "#b91c1c";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x + 38 * u, y + 30 * u);
}
