// Draft art for the Wolf Points rank ladder, crowns, bonuses and
// achievements. Generates one SVG per graphic (large, fine-line detail
// and small, bold detail) plus preview.html. Run: node generate.mjs
// In the build these become a <RankIcon rank size /> component; this file
// is the source of truth for the drawings until then.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const C = {
  navy: "#184467", navyDark: "#0e2c3f", navyMid: "#1e5a8a",
  cream: "#fcfbf2", creamDark: "#f2efe3", steel: "#b4ccd9", steelLight: "#daeaf2",
  bronze: "#C4892A", bronzeDark: "#9e6d1f", bronzeLight: "#e2ae60",
};
const INK = "currentColor"; // navy on cream, cream on navy

// Material palette: subtle tints that sit beside the brand colours.
const M = {
  plastic: { a: "#ffffff", b: "#e6edf2" },
  feather: { a: "#ffffff", b: C.cream },
  tube: { a: C.steelLight, b: C.steel },
  wood: { a: "#e3c39a", b: "#b98a57" },
  steel: { a: "#d3dee6", b: "#93aabb" },
  alu: { a: "#f1f5f8", b: "#c7d4dd" },
  carbon: { a: "#3b4a57", b: "#1c2833" },
  pro: { a: C.navyMid, b: C.navy },
  silver: { a: "#f7f9fb", b: "#a9b8c4" },
  gold: { a: "#f3d08e", b: C.bronze },
  platinum: { a: "#f4f8fb", b: "#c9d7e1" },
  diamond: { a: "#ffffff", b: C.steelLight },
};

const grad = (id, m, dir = "diag") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === "diag" ? 1 : 0}" y2="1"><stop offset="0" stop-color="${m.a}"/><stop offset="1" stop-color="${m.b}"/></linearGradient>`;

// ── League frames (shape cue for the league) ──────────────────────────
const FRAMES = {
  // 1 Shuttle: a simple round token
  1: { d: "M32 5a27 27 0 1 1 0 54a27 27 0 1 1 0-54z", fill: C.creamDark, pipsY: 53 },
  // 2 Racket: a rounded shield
  2: { d: "M32 4.5L55 12.5V31C55 45 45 54.5 32 59.5C19 54.5 9 45 9 31V12.5Z", fill: C.creamDark, pipsY: 52 },
  // 3 Precious: a faceted shield, cut like the wolf in the club crest
  3: { d: "M32 4L55 11.5L57 33L32 60L7 33L9 11.5Z", fill: "#eef4f8", facets: "M9 11.5L32 18L55 11.5M32 18V4", pipsY: 50 },
  // 4 Legend Kit: shield with a ribbon, like the crest's banner
  4: { d: "M32 4.5L55 12.5V31C55 45 45 54.5 32 59.5C19 54.5 9 45 9 31V12.5Z", fill: "#fbf3e4", ribbon: true, pipsY: 52.2 },
};

function frame(league, step, steps, large, id) {
  const f = FRAMES[league];
  const sw = large ? 2.2 : 3.6;
  let s = `<path d="${f.d}" fill="${f.fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (league === 4) s += `<path d="${f.d}" fill="none" stroke="${C.bronze}" stroke-width="${large ? 1 : 1.6}" stroke-linejoin="round" transform="translate(32 32) scale(.86) translate(-32 -32)"/>`;
  if (f.facets && large) s += `<path d="${f.facets}" fill="none" stroke="${INK}" stroke-width="1" opacity=".35" stroke-linejoin="round"/>`;
  if (f.ribbon) {
    s += `<path d="M3 45l7-3.5h44l7 3.5l-4 4l4 4l-7 0l-3-3.5H14l-3 3.5H3l4-4z" fill="${C.navy}" stroke="${INK}" stroke-width="${large ? 1.2 : 2}" stroke-linejoin="round"/>`;
  }
  if (large && steps > 1) {
    const gap = 5.2, x0 = 32 - ((steps - 1) * gap) / 2;
    for (let i = 0; i < steps; i++) {
      const on = i < step;
      const color = league === 4 ? (on ? C.bronzeLight : "rgba(252,251,242,.35)") : on ? C.bronze : "none";
      const stroke = league === 4 ? "none" : on ? C.bronze : INK;
      s += `<circle cx="${x0 + i * gap}" cy="${f.pipsY}" r="1.6" fill="${color}" stroke="${stroke}" stroke-width=".8" ${!on && league !== 4 ? 'opacity=".35"' : ""}/>`;
    }
  }
  return s;
}

// ── Items ─────────────────────────────────────────────────────────────
// Racket drawn on the diagonal: handle bottom-left, head top-right.
function racket({ mat, head = "oval", frameW = 2.2, strings = true, grip, sparkles = 0, gem = false, weave = false }, large, id) {
  const sw = large ? frameW : 3.6;
  // Head: an oval on the diagonal. Wooden/steel heads are rounder, modern
  // heads ("iso") squarer at the top, pro heads slimmer.
  const [rx, ry] = head === "round" ? [10.5, 12] : head === "iso" ? [10.8, 12.6] : [9.4, 12.8];
  const cx = 39, cy = 21;
  const headEl = (extra) =>
    head === "iso"
      ? `<rect x="${cx - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" rx="${rx * 0.92}" ry="${ry * 0.82}" transform="rotate(45 ${cx} ${cy})" ${extra}/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(45 ${cx} ${cy})" ${extra}/>`;
  const tx = cx - ry * 0.707, ty = cy + ry * 0.707; // throat, where the shaft joins
  let s = `<defs>${grad(id + "m", M[mat])}<clipPath id="${id}h">${headEl("")}</clipPath></defs>`;
  s += `<path d="M${tx} ${ty}L${tx - 9.5} ${ty + 9.5}" stroke="${INK}" stroke-width="${large ? 2 : 3.4}" stroke-linecap="round"/>`;
  if (head === "round") s += `<path d="M${tx - 2.4} ${ty - 2.4}L${tx} ${ty}L${tx + 2.4} ${ty + 2.4}" stroke="${INK}" stroke-width="${large ? 1.6 : 2.4}" stroke-linecap="round" fill="none"/>`;
  s += `<path d="M${tx - 8.5} ${ty + 8.5}L${tx - 17} ${ty + 17}" stroke="${grip ?? INK}" stroke-width="${large ? 5 : 6.5}" stroke-linecap="round"/>`;
  if (large && mat === "wood") s += `<path d="M${tx - 11} ${ty + 12}l-3 3M${tx - 12.5} ${ty + 10.5}l-2 2" stroke="${C.cream}" stroke-width=".9" stroke-linecap="round" opacity=".8"/>`;
  s += headEl(`fill="${mat === "carbon" ? "#e9eef2" : "#fff"}" opacity=".92"`);
  if (large && strings) {
    let g = "";
    for (let i = -30; i <= 70; i += 3.4) g += `M${i} -10L${i + 50} 40M${i + 50} -10L${i} 40`;
    s += `<g clip-path="url(#${id}h)"><path d="${g}" stroke="${INK}" stroke-width=".45" opacity=".35"/></g>`;
  }
  s += headEl(`fill="none" stroke="${INK}" stroke-width="${sw + (large ? 2 : 2.2)}"`);
  s += headEl(`fill="none" stroke="url(#${id}m)" stroke-width="${sw}"`);
  if (weave && large) s += headEl(`fill="none" stroke="${C.steel}" stroke-width=".6" stroke-dasharray="1.4 1.4"`);
  if (gem) s += `<path d="M${tx + 1} ${ty - 1}l3-3l3 3l-3 4z" fill="#fff" stroke="${INK}" stroke-width="${large ? 1 : 1.6}" stroke-linejoin="round"/>`;
  s += sparkle(sparkles, large);
  return s;
}

function sparkle(n, large) {
  if (!n) return "";
  const spots = [[17, 17, 3.8], [49, 42, 3.2], [12, 28, 2.6], [40, 50, 2.4]];
  let s = "";
  for (let i = 0; i < Math.min(n, large ? 4 : 1); i++) {
    const [x, y, r] = spots[i];
    s += `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z" fill="${C.bronzeLight}" stroke="${C.bronzeDark}" stroke-width=".5"/>`;
  }
  return s;
}

function shuttle({ kind }, large, id) {
  // upright shuttle, cork at the bottom
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M[kind === "plastic" ? "plastic" : "feather"], "v")}</defs>`;
  if (kind === "feather") {
    // individual feathers, scalloped tips
    s += `<path d="M24.5 37L16 13.5c2-1.8 4-1.8 5.6 0c1.6-1.8 3.6-1.8 5.4 0c1.7-1.8 3.4-1.8 5 0c1.6-1.8 3.4-1.8 5 0c1.8-1.8 3.6-1.8 5.4 0c1.6-1.8 3.6-1.8 5.6 0L39.5 37z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    if (large) s += `<path d="M27 36.5l-5-22.5M29.5 36.5l-2.5-22.8M32 36.5V13.6M34.5 36.5l2.5-22.8M37 36.5l5-22.5" stroke="${INK}" stroke-width=".8" opacity=".55"/><path d="M19 22.5h26M21.5 29.5h21" stroke="${INK}" stroke-width=".8" opacity=".55"/>`;
  } else {
    // plastic skirt: a solid cone with a mesh
    s += `<path d="M24.5 37L17 14.5Q32 10.5 47 14.5L39.5 37z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    if (large) s += `<path d="M20 20.5Q32 17.5 44 20.5M22 27Q32 24.8 42 27M23.5 32.5Q32 30.8 40.5 32.5M27.5 36.5L23 14M32 36.5V12.6M36.5 36.5L41 14" stroke="${INK}" stroke-width=".7" opacity=".45" fill="none"/>`;
  }
  s += `<path d="M24 37h16v3.5c0 5-3.6 9-8 9s-8-4-8-9z" fill="${C.creamDark}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (large) s += `<path d="M24 40.5h16" stroke="${C.bronze}" stroke-width="1.4"/>`;
  return s;
}

function tube(_, large, id) {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M.tube, "h")}</defs>`;
  // shuttle peeking out of a tube, tube on the diagonal
  s += `<g transform="rotate(28 32 32)">`;
  s += `<path d="M27 15.5L23.8 6.5Q32 4.5 40.2 6.5L37 15.5z" fill="#fff" stroke="${INK}" stroke-width="${sw * .9}" stroke-linejoin="round"/>`;
  s += `<rect x="23" y="14" width="18" height="40" rx="3" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}"/>`;
  s += `<rect x="21.5" y="13" width="21" height="5" rx="1.5" fill="${C.navy}" stroke="${INK}" stroke-width="${sw * .8}"/>`;
  s += `<rect x="21.5" y="50" width="21" height="5" rx="1.5" fill="${C.navy}" stroke="${INK}" stroke-width="${sw * .8}"/>`;
  if (large) s += `<path d="M23 28h18M23 32h18" stroke="${C.bronze}" stroke-width="1.4"/><path d="M27 22v24" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`;
  s += `</g>`;
  return s;
}

function bag(_, large) {
  const sw = large ? 1.8 : 3;
  let s = `<path d="M21 22.5c0-5 4.5-8.5 11-8.5s11 3.5 11 8.5" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`;
  s += `<rect x="11" y="21" width="42" height="21" rx="8" fill="${C.navy}" stroke="${INK}" stroke-width="${sw}"/>`;
  s += `<path d="M14 27.5h36" stroke="${C.bronzeLight}" stroke-width="${large ? 1.4 : 2}" stroke-linecap="round"/>`;
  if (large) s += `<circle cx="47" cy="27.5" r="1.6" fill="${C.bronzeLight}"/><path d="M26 32.5l3.5 4l3.5-4l-3.5-1.6z" fill="${C.cream}" opacity=".85"/><path d="M33 32.5l3.5 4l3.5-4l-3.5-1.6z" fill="${C.cream}" opacity=".55"/>`;
  return s;
}

function shoe(_, large) {
  const sw = large ? 1.8 : 3;
  let s = `<path d="M10 39.5V30c0-3 2-5 4.5-5c2.6 0 4 2.2 6.5 2.2c3 0 4.2-6.2 8-6.2c2.6 0 3.3 2.6 5.6 4.6c4.4 3.8 12.4 4.4 15.6 8.2c1.6 1.9 1.8 4 1.8 5.7z" fill="#fff" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M8.5 39.5h45.5c0 3-1.8 5-4.6 5H12.5c-2.4 0-4-2-4-5z" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (large) s += `<path d="M27 25.5l3 2.4M29.4 23.4l3 2.4M31.6 21.8l3 2.4" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><path d="M14 33.5c6 0 9-1 12.5-3.5c4 2.6 12 4.5 22 4.2" fill="none" stroke="${C.navy}" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>`;
  return s;
}

function jersey(_, large) {
  const sw = large ? 1.8 : 3;
  let s = `<path d="M24 11.5l-12 6l-4.5 10l7.5 3.5l3-5.5V51h28V25.5l3 5.5l7.5-3.5l-4.5-10l-12-6c-1 3.4-4.3 5.6-8 5.6s-7-2.2-8-5.6z" fill="${C.navy}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M24 11.5c1 3.4 4.3 5.6 8 5.6s7-2.2 8-5.6" fill="none" stroke="${C.bronzeLight}" stroke-width="${large ? 1.6 : 2.2}"/>`;
  // small faceted wolf mark on the chest
  s += `<path d="M32 38.5l-5.5-5.5l-1-6l3.5 2.6h6l3.5-2.6l-1 6z" fill="${C.cream}"/>`;
  if (large) s += `<path d="M32 30.5v7" stroke="${C.navy}" stroke-width="1"/>`;
  return s;
}

function trophy({ laurel = false } = {}, large, id) {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M.gold)}</defs>`;
  s += `<path d="M21 13.5c-6 0-7.5 3-7.5 5.5c0 4.8 4.4 8 9.4 8.6M43 13.5c6 0 7.5 3 7.5 5.5c0 4.8-4.4 8-9.4 8.6" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`;
  s += `<path d="M20 11.5h24v8c0 7.4-5.4 13-12 13s-12-5.6-12-13z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M29.5 32.5h5v6h-5z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw * .8}"/>`;
  s += `<path d="M22.5 44.5c0-3.4 2.6-6 6-6h7c3.4 0 6 2.6 6 6v2h-19z" fill="${C.navy}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (large) s += `<path d="M24.5 15v5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".75"/><path d="M32 16.5l1.4 2.8l3 .4l-2.2 2.1l.5 3l-2.7-1.4l-2.7 1.4l.5-3l-2.2-2.1l3-.4z" fill="#fff" opacity=".9"/>`;
  if (laurel) s += laurelPath(large);
  return s;
}

function laurelPath(large) {
  const sw = large ? 1.4 : 2.2;
  let s = `<path d="M15 50C8 44 6 34 9 24M49 50c7-6 9-16 6-26" fill="none" stroke="${C.bronze}" stroke-width="${sw}" stroke-linecap="round"/>`;
  if (large) for (const [x, y, r] of [[8.5, 30, -30], [9.5, 38, -10], [12.5, 45, 15], [55.5, 30, 30], [54.5, 38, 10], [51.5, 45, -15]])
    s += `<ellipse cx="${x}" cy="${y}" rx="2.2" ry="4" transform="rotate(${r} ${x} ${y})" fill="${C.bronzeLight}"/>`;
  return s;
}

// Faceted wolf head in the language of the club crest (simplified).
function wolf({ mat }, large, id) {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M[mat])}</defs>`;
  s += `<path d="M32 55L20.5 42L15 23.5L13.5 7.5L25.5 17.5H38.5L50.5 7.5L49 23.5L43.5 42Z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M32 18.5L27.5 30L32 49L36.5 30Z" fill="${mat === "gold" ? C.cream : "#fff"}" stroke="${INK}" stroke-width="${large ? 1 : 1.8}" stroke-linejoin="round"/>`;
  s += `<path d="M21 30.5l5.5 2.2l.6 2.8l-5-2.2zM43 30.5l-5.5 2.2l-.6 2.8l5-2.2z" fill="${C.navy}"/>`;
  if (large) s += `<path d="M17.5 12.5l5 6M46.5 12.5l-5 6" stroke="${INK}" stroke-width="1" opacity=".5"/><path d="M29.5 49.5l2.5 2.2l2.5-2.2" fill="none" stroke="${C.navy}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

function crownShape(x, y, w, h, fill, large) {
  const sw = large ? 1.6 : 2.6;
  const d = `M${x} ${y + h}l${-w * .04} ${-h * .78}l${w * .27} ${h * .38}l${w * .27} ${-h * .6}l${w * .27} ${h * .6}l${w * .27} ${-h * .38}l${-w * .04} ${h * .78}z`;
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

// ── Ladder ────────────────────────────────────────────────────────────
const LADDER = [
  { key: "plastic-shuttle", en: "Plastic Shuttle", vi: "Cầu Nhựa", league: 1, draw: (l, id) => shuttle({ kind: "plastic" }, l, id) },
  { key: "feather-shuttle", en: "Feather Shuttle", vi: "Cầu Lông Vũ", league: 1, draw: (l, id) => shuttle({ kind: "feather" }, l, id) },
  { key: "shuttle-tube", en: "Shuttle Tube", vi: "Ống Cầu", league: 1, draw: (l, id) => tube({}, l, id) },
  { key: "wooden-racket", en: "Wooden Racket", vi: "Vợt Gỗ", league: 2, draw: (l, id) => racket({ mat: "wood", head: "round", frameW: 4, strings: true, grip: "#8a5f36" }, l, id) },
  { key: "steel-racket", en: "Steel Racket", vi: "Vợt Thép", league: 2, draw: (l, id) => racket({ mat: "steel", head: "round", frameW: 3 }, l, id) },
  { key: "aluminium-racket", en: "Aluminium Racket", vi: "Vợt Nhôm", league: 2, draw: (l, id) => racket({ mat: "alu", head: "iso", frameW: 3 }, l, id) },
  { key: "carbon-fibre-racket", en: "Carbon Fibre Racket", vi: "Vợt Sợi Carbon", league: 2, draw: (l, id) => racket({ mat: "carbon", head: "iso", frameW: 2.6, weave: true }, l, id) },
  { key: "pro-racket", en: "Pro Racket", vi: "Vợt Chuyên Nghiệp", league: 2, draw: (l, id) => racket({ mat: "pro", head: "oval", frameW: 2.2, grip: C.bronze }, l, id) },
  { key: "silver-plated-racket", en: "Silver-plated Racket", vi: "Vợt Mạ Bạc", league: 3, draw: (l, id) => racket({ mat: "silver", frameW: 3, grip: C.navy, sparkles: 1 }, l, id) },
  { key: "golden-racket", en: "Golden Racket", vi: "Vợt Vàng", league: 3, draw: (l, id) => racket({ mat: "gold", frameW: 3, grip: C.navy, sparkles: 2 }, l, id) },
  { key: "platinum-racket", en: "Platinum Racket", vi: "Vợt Bạch Kim", league: 3, draw: (l, id) => racket({ mat: "platinum", frameW: 3, grip: C.navy, sparkles: 3 }, l, id) },
  { key: "diamond-racket", en: "Diamond Racket", vi: "Vợt Kim Cương", league: 3, draw: (l, id) => racket({ mat: "diamond", frameW: 3, grip: C.navy, sparkles: 4, gem: true }, l, id) },
  { key: "racket-bag", en: "Racket Bag", vi: "Túi Vợt", league: 4, draw: (l, id) => bag({}, l, id) },
  { key: "court-shoes", en: "Court Shoes", vi: "Giày Thi Đấu", league: 4, draw: (l, id) => shoe({}, l, id) },
  { key: "club-jersey", en: "Club Jersey", vi: "Áo Câu Lạc Bộ", league: 4, draw: (l, id) => jersey({}, l, id) },
  { key: "champions-trophy", en: "Champion's Trophy", vi: "Cúp Vô Địch", league: 4, draw: (l, id) => trophy({}, l, id) },
];
const LEAGUES = { 1: "Shuttle", 2: "Racket", 3: "Precious Racket", 4: "Legend Kit" };

// Item art is drawn at full size and shrunk into the frame so the frame
// stays readable. Legend Kit items sit higher, above the ribbon.
const INSET = { 1: "translate(32 30.5) scale(.86) translate(-32 -32)", 2: "translate(33.5 29.5) scale(.82) translate(-31.5 -30)", 3: "translate(33 28.5) scale(.78) translate(-31.5 -30)", 4: "translate(32 27) scale(.72) translate(-32 -32)" };

const wrap = (inner, title, color = C.navy) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${title}" style="color:${color}"><title>${title}</title>${inner}</svg>`;

const files = [];
function emit(group, key, label, svgFor) {
  for (const size of ["lg", "sm"]) {
    const large = size === "lg";
    const svg = svgFor(large, `${key}-${size}`);
    const path = join(OUT, group, `${key}.${size}.svg`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, svg);
  }
  files.push({ group, key, label });
}

// rank icons
const byLeague = {};
for (const r of LADDER) (byLeague[r.league] ??= []).push(r);
for (const r of LADDER) {
  const steps = byLeague[r.league].length;
  const step = byLeague[r.league].indexOf(r) + 1;
  emit("ranks", r.key, r.en, (large, id) =>
    wrap(frame(r.league, step, steps, large, id) + `<g transform="${INSET[r.league]}">${r.draw(large, id)}</g>`, r.en));
}

// Wolf seats: the crest-style wolf on a faceted crest
emit("ranks", "silver-wolf", "Silver Wolf", (large, id) =>
  wrap(`<path d="M32 3L58 14L54 42L32 61L10 42L6 14Z" fill="${C.navy}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}" stroke-linejoin="round"/><path d="M32 3L58 14L54 42L32 61L10 42L6 14Z" fill="none" stroke="${C.steel}" stroke-width="${large ? 1.2 : 1.8}" transform="translate(32 32) scale(.88) translate(-32 -32)" stroke-linejoin="round"/><g transform="translate(32 33) scale(.72) translate(-32 -32)" style="color:${C.cream}">${wolf({ mat: "silver" }, large, id)}</g>`, "Silver Wolf"));
emit("ranks", "alpha-wolf", "Alpha Wolf", (large, id) =>
  wrap(`<path d="M32 3L58 14L54 42L32 61L10 42L6 14Z" fill="${C.navyDark}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}" stroke-linejoin="round"/><path d="M32 3L58 14L54 42L32 61L10 42L6 14Z" fill="none" stroke="${C.bronzeLight}" stroke-width="${large ? 1.2 : 1.8}" transform="translate(32 32) scale(.88) translate(-32 -32)" stroke-linejoin="round"/><g transform="translate(32 35) scale(.66) translate(-32 -32)" style="color:${C.cream}">${wolf({ mat: "gold" }, large, id)}</g>${crownShape(24, 6, 16, 9, C.bronzeLight, large)}`, "Alpha Wolf"));

// Crowns (round medallions so they never get mistaken for a rank)
const medal = (inner, ring, large, fill = C.cream) =>
  `<circle cx="32" cy="32" r="27" fill="${fill}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}"/><circle cx="32" cy="32" r="22.5" fill="none" stroke="${ring}" stroke-width="${large ? 1.4 : 2}"/>${inner}`;
emit("crowns", "crown-pair", "Crown pair", (large, id) =>
  wrap(medal(`${crownShape(17, 19, 30, 17, C.bronzeLight, large)}<circle cx="26" cy="45" r="3.4" fill="${C.navy}"/><circle cx="38" cy="45" r="3.4" fill="${C.navy}"/>`, C.bronze, large), "Crown pair"));
emit("crowns", "pack-leader", "Pack Leader", (large, id) =>
  wrap(medal(`<ellipse cx="32" cy="38" rx="8.5" ry="7.5" fill="${C.navy}"/><ellipse cx="21.5" cy="28" rx="3.4" ry="4.4" transform="rotate(-20 21.5 28)" fill="${C.navy}"/><ellipse cx="28" cy="22" rx="3.4" ry="4.6" transform="rotate(-6 28 22)" fill="${C.navy}"/><ellipse cx="36" cy="22" rx="3.4" ry="4.6" transform="rotate(6 36 22)" fill="${C.navy}"/><ellipse cx="42.5" cy="28" rx="3.4" ry="4.4" transform="rotate(20 42.5 28)" fill="${C.navy}"/>`, C.steel, large), "Pack Leader"));
emit("crowns", "season-champion", "Season champion", (large, id) =>
  wrap(medal(`<g transform="translate(32 33) scale(.7) translate(-32 -32)">${trophy({ laurel: true }, large, id)}</g>`, C.bronze, large, "#fbf3e4"), "Season champion"));

// Bonus chips: line glyphs in the style of the profile tab icons
const line = (d, extra = "") =>
  `<g fill="none" stroke="${INK}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${d}</g>${extra}`;
emit("bonuses", "giant-killer", "Giant-killer +2", () =>
  wrap(line(`<path d="M8 52L26 18L36 34L42 26L56 52Z"/><path d="M26 18V7l9 4l-9 4"/>`, `<path d="M26 7l9 4l-9 4z" fill="${C.bronze}"/>`), "Giant-killer"));
emit("bonuses", "new-rival", "New rival +1", () =>
  wrap(line(`<circle cx="22" cy="24" r="8"/><path d="M8 52c0-8 6-13 14-13s14 5 14 13"/><circle cx="44" cy="20" r="6"/><path d="M40 33c8 0 14 5 14 13"/>`, `<circle cx="51" cy="13" r="7" fill="${C.bronze}"/><path d="M51 9.5v7M47.5 13h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`), "New rival"));
emit("bonuses", "hot-streak", "Hot streak +1", () =>
  wrap(`<path d="M32 58c-11 0-18-7.5-18-17c0-9 6-13 8-21c4 4 4 8 4 11c4-6 3-14 0-24c12 6 22 17 22 32c0 11-6 19-16 19z" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M32 52c-5 0-8-3.5-8-8c0-4.4 3-6 4.4-10c3 3 4.6 5 4.6 8c2-2 2.8-4.4 2.8-6.6c3 2.6 4.2 5.8 4.2 9.4c0 4.4-3 7.2-8 7.2z" fill="${C.bronze}"/>`, "Hot streak"));
emit("bonuses", "crown-bounty", "Crown bounty +4", (large) =>
  wrap(`${crownShape(8, 18, 40, 26, C.bronzeLight, false)}<circle cx="49" cy="46" r="11" fill="${C.navy}" stroke="${INK}" stroke-width="3"/><path d="M49 40v12M43 46h12" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`, "Crown bounty"));

// Achievements: bronze-ringed medallions with one simple glyph each
const ach = (key, label, inner) =>
  emit("achievements", key, label, (large) => wrap(medal(inner, C.bronze, large), label));
const g = (d, sw = 3.4) => `<g fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
ach("first-blood", "First Blood", `<g transform="rotate(-35 32 32)">${g(`<path d="M27 40L21 17Q32 14 43 17L37 40z"/><path d="M27 40h10v2.5c0 3-2.2 5.5-5 5.5s-5-2.5-5-5.5z"/>`, 2.6)}</g><path d="M46 14l2 5l5 2l-5 2l-2 5l-2-5l-5-2l5-2z" fill="${C.bronze}"/>`);
ach("golden-point", "Golden Point", `${g(`<path d="M14 46h36"/><path d="M32 46v-4"/>`, 2.6)}<circle cx="32" cy="34" r="6" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="2.6"/><path d="M22 22c4-5 8-7 10-7s6 2 10 7" fill="none" stroke="${C.bronze}" stroke-width="2.6" stroke-dasharray="3 3" stroke-linecap="round"/>`);
ach("nail-biter", "Nail-biter", g(`<path d="M22 14h20M22 50h20M24 14c0 9 8 11 8 18s-8 9-8 18M40 14c0 9-8 11-8 18s8 9 8 18"/>`, 2.8) + `<path d="M27 46c2-4 3.4-6 5-6s3 2 5 6z" fill="${C.bronze}"/>`);
ach("social-wolf", "Social Wolf", g(`<path d="M32 17L18 40M32 17L46 40M18 40h28M32 17v14M18 40l14-9l14 9"/>`, 2.2) + [[32, 17], [18, 40], [46, 40], [32, 31]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 4.2 : 5}" fill="${i === 3 ? C.bronze : C.navy}"/>`).join(""));
ach("loyal-partner", "Loyal Partner", g(`<circle cx="26" cy="32" r="10"/>`, 3.2) + `<circle cx="38" cy="32" r="10" fill="none" stroke="${C.bronze}" stroke-width="3.2"/>`);
ach("giant-killer", "Giant-killer", g(`<path d="M13 46L27 21L35 33L40 27L51 46Z"/><path d="M27 21v-8l7 3l-7 3"/>`, 2.8) + `<path d="M27 13l7 3l-7 3z" fill="${C.bronze}"/>`);
ach("crown-taker", "Crown Taker", crownShape(17, 22, 30, 17, C.bronzeLight, true) + g(`<path d="M32 50V43M28 46.5l4-4l4 4"/>`, 2.6));
ach("hot-streak", "Hot Streak", `<g transform="translate(32 32) scale(.62) translate(-32 -32)"><path d="M32 58c-11 0-18-7.5-18-17c0-9 6-13 8-21c4 4 4 8 4 11c4-6 3-14 0-24c12 6 22 17 22 32c0 11-6 19-16 19z" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></g>`);
ach("iron-wolf", "Iron Wolf", g(`<rect x="17" y="19" width="30" height="27" rx="4"/><path d="M17 27h30M24 15v7M40 15v7"/>`, 2.6) + `<path d="M24 36l5 5l11-10" fill="none" stroke="${C.bronze}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`);
ach("polished", "Polished", `<g transform="translate(32 32) scale(.62) translate(-32 -32)">${racket({ mat: "gold", frameW: 3, grip: C.navy }, true, "pol")}</g><path d="M44 14l2 5l5 2l-5 2l-2 5l-2-5l-5-2l5-2z" fill="${C.bronzeLight}" stroke="${C.bronzeDark}" stroke-width=".6"/><path d="M18 44l1.4 3.4l3.4 1.4l-3.4 1.4l-1.4 3.4l-1.4-3.4l-3.4-1.4l3.4-1.4z" fill="${C.bronzeLight}"/>`);

// ── Preview sheet ─────────────────────────────────────────────────────
const img = (f, size, sz = "lg", cls = "") => `<img class="${cls}" src="${f.group}/${f.key}.${sz}.svg" width="${size}" height="${size}" alt="${f.label}">`;
const ranks = files.filter((f) => f.group === "ranks");
const thresholds = [0, 3, 8, 16, 28, 44, 64, 90, 125, 165, 210, 260, 330, 400, 480, 570];
const leagueOf = (k) => LADDER.find((r) => r.key === k)?.league;
let html = `<!doctype html><meta charset="utf-8"><title>Three Wolves · rank art draft</title>
<style>
@font-face{font-family:Copperplate;src:url(../../../public/fonts/UTM-CopperplateB.ttf)}
@font-face{font-family:Montserrat;src:url(../../../public/uploads/Montserrat-Regular.ttf)}
@font-face{font-family:Montserrat;font-weight:700;src:url(../../../public/uploads/Montserrat-Bold.ttf)}
body{margin:0;background:#fcfbf2;color:#0d1b26;font-family:Montserrat,sans-serif;font-size:13px}
.wrap{max-width:1180px;margin:0 auto;padding:36px}
h1,h2{font-family:Copperplate,serif;color:#184467;letter-spacing:.06em;text-transform:uppercase;margin:0}
h1{font-size:30px}h2{font-size:17px;margin:34px 0 4px}
.eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#C4892A;font-weight:700}
.sub{color:#3a526a;margin:4px 0 14px;max-width:760px;line-height:1.55}
.ladder{display:grid;grid-template-columns:repeat(9,1fr);gap:10px}
.cell{background:#fff;border-radius:14px;box-shadow:0 2px 16px rgba(24,68,103,.08);padding:12px 6px 10px;text-align:center}
.cell img{margin:0 auto 6px;display:block}
.name{font-weight:700;color:#184467;font-size:11.5px;line-height:1.25}
.meta{color:#7a9ab0;font-size:10.5px;margin-top:2px}
.league{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#C4892A;font-weight:700;margin-bottom:6px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.navy{background:radial-gradient(120% 90% at 50% 0%,#1e5a8a 0%,#0e2c3f 70%);color:#fcfbf2;border-radius:18px;padding:20px 22px}
.list{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(24,68,103,.08);overflow:hidden;max-width:520px}
.li{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #f2efe3;font-size:14px}
.li:first-child{border-top:0}.li b{width:22px;text-align:center;color:#7a9ab0}.li span{flex:1;font-weight:700;color:#184467}.li em{font-style:normal;font-weight:700;color:#9e6d1f}
.tarnish{filter:grayscale(.75) brightness(.97) contrast(.9)}
.locked{filter:grayscale(1) brightness(1.5);opacity:.28}
.card{width:300px;border-radius:22px;padding:26px 22px 22px;text-align:center;background:radial-gradient(120% 90% at 50% 0%,#1e5a8a 0%,#0e2c3f 70%);color:#fcfbf2;box-shadow:0 8px 40px rgba(24,68,103,.14)}
.card h3{font-family:Copperplate,serif;font-size:24px;letter-spacing:.06em;margin:6px 0 2px;text-transform:uppercase}
.bar{height:8px;border-radius:99px;background:rgba(255,255,255,.15);overflow:hidden;margin:14px 0 6px}.bar i{display:block;height:100%;width:62%;background:linear-gradient(90deg,#e2ae60,#C4892A)}
.chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border-radius:999px;padding:5px 12px 5px 6px;font-weight:700;color:#184467;box-shadow:0 2px 10px rgba(24,68,103,.08)}
.chip.dark{background:rgba(255,255,255,.1);color:#fcfbf2;box-shadow:none}
.kit{display:grid;grid-template-columns:repeat(8,64px);gap:10px;background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 16px rgba(24,68,103,.08);width:max-content}
.cols{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start}
</style><div class="wrap">
<div class="eyebrow">Draft · Wolf Points</div><h1>Rank ladder art</h1>
<p class="sub">League = frame shape (round token, shield, faceted crest shield, banner shield). Rank = the item and its material. Step within the league = the pips. Large sizes use the fine-line drawings; 16–24&nbsp;px use the bold versions. Thresholds in WP are first guesses at 1 WP per play day, to be tuned on the dry run.</p>
<div class="ladder">`;
ranks.forEach((f, i) => {
  const lg = leagueOf(f.key);
  const wp = i < thresholds.length ? `${thresholds[i]} WP` : f.key === "alpha-wolf" ? "Top 1 · 90 days" : "Top 2–4 · 90 days";
  html += `<div class="cell"><div class="league">${lg ? LEAGUES[lg] : "Wolf seat"}</div>${img(f, 72)}<div class="name">${f.label}</div><div class="meta">${wp}</div></div>`;
});
html += `</div>
<h2>Small sizes (bold set)</h2><p class="sub">Next to names on leaderboards and the challenge board: 16, 20 and 24&nbsp;px, on cream and on navy.</p>
<div class="cols"><div class="row">${ranks.map((f) => img(f, 24, "sm")).join("")}</div></div>
<div class="row" style="margin-top:8px">${ranks.map((f) => img(f, 16, "sm")).join("")}</div>
<div class="navy" style="margin-top:12px"><div class="row">${ranks.map((f) => `<span style="display:inline-block">${img(f, 24, "sm")}</span>`).join("")}</div></div>

<h2>In context</h2>
<div class="cols" style="margin-top:12px">
<div class="list">
<div class="li"><b>1</b>${img(ranks[17], 22, "sm")}<span>Hòa</span><em>212 WP</em></div>
<div class="li"><b>2</b>${img(ranks[16], 22, "sm")}<span>Sơn</span><em>188 WP</em></div>
<div class="li"><b>3</b>${img(ranks[9], 22, "sm")}<span>Timba</span><em>176 WP</em></div>
<div class="li"><b>4</b>${img(ranks[8], 22, "sm", "tarnish")}<span>Quang <small style="font-weight:500;color:#7a9ab0">· tarnishing</small></span><em>150 WP</em></div>
<div class="li"><b>5</b>${img(ranks[6], 22, "sm")}<span>Ly</span><em>81 WP</em></div>
<div class="li"><b>6</b>${img(ranks[3], 22, "sm")}<span>Kelcee</span><em>19 WP</em></div>
<div class="li"><b>7</b>${img(ranks[0], 22, "sm")}<span>New player</span><em>1 WP</em></div>
</div>
<div class="card"><div class="eyebrow" style="color:#e2ae60">Rank up</div>${img(ranks[6], 132).replace("<img", '<img style="margin:12px auto 4px;display:block"')}<h3>Carbon Fibre Racket</h3><div style="opacity:.75">Racket league · step 4 of 5</div><div class="bar"><i></i></div><div style="font-size:12px;opacity:.75">22 WP to Pro Racket</div></div>
<div>
<div class="row">${["crown-pair", "pack-leader", "season-champion"].map((k) => { const f = files.find((x) => x.key === k); return `<div class="cell" style="width:110px">${img(f, 64)}<div class="name">${f.label}</div></div>`; }).join("")}</div>
<div class="row" style="margin-top:14px">${files.filter((f) => f.group === "bonuses").map((f) => `<span class="chip">${img(f, 22, "sm")}${f.label}</span>`).join("")}</div>
<div class="navy row" style="margin-top:14px">${files.filter((f) => f.group === "bonuses").map((f) => `<span class="chip dark">${img(f, 22, "sm").replace("<img", '<img style="filter:invert(1) hue-rotate(180deg) brightness(1.4)"')}${f.label}</span>`).join("")}</div>
</div></div>

<h2>Kit bag</h2><p class="sub">Earned items in full colour; the next three as locked silhouettes; a tarnished item dulls until the player is active again.</p>
<div class="kit">${ranks.slice(0, 8).map((f, i) => img(f, 64, "lg", i === 7 ? "" : "")).join("")}${ranks.slice(8, 11).map((f) => img(f, 64, "lg", "locked")).join("")}</div>
<div class="row" style="margin-top:10px"><span class="chip">${img(ranks[9], 22, "sm")}Golden Racket</span><span class="chip">${img(ranks[9], 22, "sm", "tarnish")}Golden Racket · tarnishing</span></div>

<h2>Achievements</h2>
<div class="row" style="margin-top:10px">${files.filter((f) => f.group === "achievements").map((f) => `<div class="cell" style="width:104px">${img(f, 56)}<div class="name">${f.label}</div></div>`).join("")}</div>
</div>`;
writeFileSync(join(OUT, "preview.html"), html);
console.log(`${files.length} graphics, ${files.length * 2} SVG files`);
