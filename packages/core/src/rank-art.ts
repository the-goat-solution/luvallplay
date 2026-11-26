// Rank, crown, bonus and achievement art as SVG markup (64×64 viewBox).
// Two detail levels: "lg" (fine lines, strings, pips; 48 px and up) and "sm"
// (bold; 16–24 px next to names). Strokes use currentColor so the same icon
// works on cream (navy outline) and on navy (cream outline).
//
// Design: docs/plans/challenges.md §9. Every drawing is original.

import { LADDER, type ItemKey, type KitKey, type League, type AchievementKey } from "./ranks.ts";

export type ArtSize = "lg" | "sm";

const C = {
  navy: "#184467",
  navyDark: "#0e2c3f",
  navyMid: "#1e5a8a",
  cream: "#fcfbf2",
  creamDark: "#f2efe3",
  steel: "#b4ccd9",
  steelLight: "#daeaf2",
  bronze: "#C4892A",
  bronzeDark: "#9e6d1f",
  bronzeLight: "#e2ae60",
};
const INK = "currentColor";

type Mat = { a: string; b: string };
const M: Record<string, Mat> = {
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

const grad = (id: string, m: Mat, dir: "diag" | "v" | "h" = "diag") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === "diag" || dir === "h" ? 1 : 0}" y2="${dir === "h" ? 0 : 1}"><stop offset="0" stop-color="${m.a}"/><stop offset="1" stop-color="${m.b}"/></linearGradient>`;

// ── Frames: one shape per league ──────────────────────────────────────
const SHIELD = "M32 4.5L55 12.5V31C55 45 45 54.5 32 59.5C19 54.5 9 45 9 31V12.5Z";
const FRAMES: Record<League, { d: string; fill: string; facets?: string; ribbon?: boolean; pipsY: number }> = {
  1: { d: "M32 5a27 27 0 1 1 0 54a27 27 0 1 1 0-54z", fill: C.creamDark, pipsY: 53 },
  2: { d: SHIELD, fill: C.creamDark, pipsY: 52 },
  3: { d: "M32 4L55 11.5L57 33L32 60L7 33L9 11.5Z", fill: "#eef4f8", facets: "M9 11.5L32 18L55 11.5M32 18V4", pipsY: 50 },
  4: { d: SHIELD, fill: "#fbf3e4", ribbon: true, pipsY: 52.2 },
};

function frame(league: League, large: boolean): string {
  const f = FRAMES[league];
  let s = `<path d="${f.d}" fill="${f.fill}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}" stroke-linejoin="round"/>`;
  if (league === 4)
    s += `<path d="${f.d}" fill="none" stroke="${C.bronze}" stroke-width="${large ? 1 : 1.6}" stroke-linejoin="round" transform="translate(32 32) scale(.86) translate(-32 -32)"/>`;
  if (f.facets && large) s += `<path d="${f.facets}" fill="none" stroke="${INK}" stroke-width="1" opacity=".35" stroke-linejoin="round"/>`;
  return s;
}

function ribbon(large: boolean): string {
  return `<path d="M3 45l7-3.5h44l7 3.5l-4 4l4 4l-7 0l-3-3.5H14l-3 3.5H3l4-4z" fill="${C.navy}" stroke="${INK}" stroke-width="${large ? 1.2 : 2}" stroke-linejoin="round"/>`;
}

// ── Items ─────────────────────────────────────────────────────────────
function sparkle(n: number, large: boolean): string {
  const spots: [number, number, number][] = [[17, 17, 3.8], [49, 42, 3.2], [12, 28, 2.6], [40, 50, 2.4]];
  let s = "";
  for (let i = 0; i < Math.min(n, large ? 4 : 1); i++) {
    const [x, y, r] = spots[i];
    s += `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z" fill="${C.bronzeLight}" stroke="${C.bronzeDark}" stroke-width=".5"/>`;
  }
  return s;
}

function racket(
  o: { mat: string; head?: "oval" | "round" | "iso"; frameW?: number; strings?: boolean; grip?: string; sparkles?: number; gem?: boolean; weave?: boolean },
  large: boolean,
  id: string,
): string {
  const { mat, head = "oval", frameW = 2.2, strings = true, grip, sparkles = 0, gem = false, weave = false } = o;
  const sw = large ? frameW : 3.6;
  const [rx, ry] = head === "round" ? [10.5, 12] : head === "iso" ? [10.8, 12.6] : [9.4, 12.8];
  const cx = 39;
  const cy = 21;
  const headEl = (extra: string) =>
    head === "iso"
      ? `<rect x="${cx - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" rx="${rx * 0.92}" ry="${ry * 0.82}" transform="rotate(45 ${cx} ${cy})" ${extra}/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(45 ${cx} ${cy})" ${extra}/>`;
  const tx = cx - ry * 0.707;
  const ty = cy + ry * 0.707;
  let s = `<defs>${grad(id + "m", M[mat])}<clipPath id="${id}h">${headEl("")}</clipPath></defs>`;
  s += `<path d="M${tx} ${ty}L${tx - 9.5} ${ty + 9.5}" stroke="${INK}" stroke-width="${large ? 2 : 3.4}" stroke-linecap="round"/>`;
  if (head === "round")
    s += `<path d="M${tx - 2.4} ${ty - 2.4}L${tx} ${ty}L${tx + 2.4} ${ty + 2.4}" stroke="${INK}" stroke-width="${large ? 1.6 : 2.4}" stroke-linecap="round" fill="none"/>`;
  s += `<path d="M${tx - 8.5} ${ty + 8.5}L${tx - 17} ${ty + 17}" stroke="${grip ?? INK}" stroke-width="${large ? 5 : 6.5}" stroke-linecap="round"/>`;
  if (large && mat === "wood")
    s += `<path d="M${tx - 11} ${ty + 12}l-3 3M${tx - 12.5} ${ty + 10.5}l-2 2" stroke="${C.cream}" stroke-width=".9" stroke-linecap="round" opacity=".8"/>`;
  s += headEl(`fill="${mat === "carbon" ? "#e9eef2" : "#fff"}" opacity=".92"`);
  if (large && strings) {
    let g = "";
    for (let i = -30; i <= 70; i += 3.4) g += `M${i} -10L${i + 50} 40M${i + 50} -10L${i} 40`;
    s += `<g clip-path="url(#${id}h)"><path d="${g}" stroke="${INK}" stroke-width=".45" opacity=".35"/></g>`;
  }
  s += headEl(`fill="none" stroke="${INK}" stroke-width="${sw + (large ? 2 : 2.2)}"`);
  s += headEl(`fill="none" stroke="url(#${id}m)" stroke-width="${sw}"`);
  if (weave && large) s += headEl(`fill="none" stroke="${C.steel}" stroke-width=".6" stroke-dasharray="1.4 1.4"`);
  if (gem)
    s += `<path d="M${tx + 1} ${ty - 1}l3-3l3 3l-3 4z" fill="#fff" stroke="${INK}" stroke-width="${large ? 1 : 1.6}" stroke-linejoin="round"/>`;
  s += sparkle(sparkles, large);
  return s;
}

function shuttle(kind: "plastic" | "feather", large: boolean, id: string): string {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M[kind === "plastic" ? "plastic" : "feather"], "v")}</defs>`;
  if (kind === "feather") {
    s += `<path d="M24.5 37L16 13.5c2-1.8 4-1.8 5.6 0c1.6-1.8 3.6-1.8 5.4 0c1.7-1.8 3.4-1.8 5 0c1.6-1.8 3.4-1.8 5 0c1.8-1.8 3.6-1.8 5.4 0c1.6-1.8 3.6-1.8 5.6 0L39.5 37z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    if (large)
      s += `<path d="M27 36.5l-5-22.5M29.5 36.5l-2.5-22.8M32 36.5V13.6M34.5 36.5l2.5-22.8M37 36.5l5-22.5" stroke="${INK}" stroke-width=".8" opacity=".55"/><path d="M19 22.5h26M21.5 29.5h21" stroke="${INK}" stroke-width=".8" opacity=".55"/>`;
  } else {
    s += `<path d="M24.5 37L17 14.5Q32 10.5 47 14.5L39.5 37z" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    if (large)
      s += `<path d="M20 20.5Q32 17.5 44 20.5M22 27Q32 24.8 42 27M23.5 32.5Q32 30.8 40.5 32.5M27.5 36.5L23 14M32 36.5V12.6M36.5 36.5L41 14" stroke="${INK}" stroke-width=".7" opacity=".45" fill="none"/>`;
  }
  s += `<path d="M24 37h16v3.5c0 5-3.6 9-8 9s-8-4-8-9z" fill="${C.creamDark}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (large) s += `<path d="M24 40.5h16" stroke="${C.bronze}" stroke-width="1.4"/>`;
  return s;
}

function tube(large: boolean, id: string): string {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "m", M.tube, "h")}</defs><g transform="rotate(28 32 32)">`;
  s += `<path d="M27 15.5L23.8 6.5Q32 4.5 40.2 6.5L37 15.5z" fill="#fff" stroke="${INK}" stroke-width="${sw * 0.9}" stroke-linejoin="round"/>`;
  s += `<rect x="23" y="14" width="18" height="40" rx="3" fill="url(#${id}m)" stroke="${INK}" stroke-width="${sw}"/>`;
  s += `<rect x="21.5" y="13" width="21" height="5" rx="1.5" fill="${C.navy}" stroke="${INK}" stroke-width="${sw * 0.8}"/>`;
  s += `<rect x="21.5" y="50" width="21" height="5" rx="1.5" fill="${C.navy}" stroke="${INK}" stroke-width="${sw * 0.8}"/>`;
  if (large) s += `<path d="M23 28h18M23 32h18" stroke="${C.bronze}" stroke-width="1.4"/><path d="M27 22v24" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`;
  return s + `</g>`;
}

const ITEM_ART: Record<ItemKey, (large: boolean, id: string) => string> = {
  plastic: (l, id) => shuttle("plastic", l, id),
  feather: (l, id) => shuttle("feather", l, id),
  tube: (l, id) => tube(l, id),
  wooden: (l, id) => racket({ mat: "wood", head: "round", frameW: 4, grip: "#8a5f36" }, l, id),
  steel: (l, id) => racket({ mat: "steel", head: "round", frameW: 3 }, l, id),
  aluminium: (l, id) => racket({ mat: "alu", head: "iso", frameW: 3 }, l, id),
  carbon: (l, id) => racket({ mat: "carbon", head: "iso", frameW: 2.6, weave: true }, l, id),
  pro: (l, id) => racket({ mat: "pro", head: "oval", frameW: 2.2, grip: C.bronze }, l, id),
  silver: (l, id) => racket({ mat: "silver", frameW: 3, grip: C.navy, sparkles: 1 }, l, id),
  golden: (l, id) => racket({ mat: "gold", frameW: 3, grip: C.navy, sparkles: 2 }, l, id),
  platinum: (l, id) => racket({ mat: "platinum", frameW: 3, grip: C.navy, sparkles: 3 }, l, id),
  diamond: (l, id) => racket({ mat: "diamond", frameW: 3, grip: C.navy, sparkles: 4, gem: true }, l, id),
};

const INSET: Record<League, string> = {
  1: "translate(32 30.5) scale(.86) translate(-32 -32)",
  2: "translate(33.5 29.5) scale(.82) translate(-31.5 -30)",
  3: "translate(33 28.5) scale(.78) translate(-31.5 -30)",
  4: "translate(33 26.5) scale(.7) translate(-31.5 -30)",
};

// ── The Luvallplay set: the same ladder, sport-neutral ─────────────────
/**
 * Whose drawings: "three-wolves" (the club's own: shuttles and rackets, wolf
 * crests, its navy and bronze) or "luvallplay" (any club: the same frames and
 * steps, with chevrons, stars, a bolt, a flame and gems for the items, plain
 * crests for the top seats, and the club's own colours, see clubColoured).
 */
export type ArtSet = "three-wolves" | "luvallplay";
export const artSetOf = (name: string | null | undefined): ArtSet => (name === "three-wolves" ? "three-wolves" : "luvallplay");

const emblem = (d: string, mat: string, large: boolean, id: string) =>
  `<defs>${grad(id + "e", M[mat])}</defs><path d="${d}" fill="url(#${id}e)" stroke="${INK}" stroke-width="${large ? 2 : 3.2}" stroke-linejoin="round" stroke-linecap="round"/>`;
const STAR = (cx: number, cy: number, r: number) => {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
};
const CHEVRON = (cy: number) => `M18 ${cy + 7}L32 ${cy - 4}L46 ${cy + 7}L46 ${cy + 13}L32 ${cy + 2}L18 ${cy + 13}Z`;
const chevrons = (n: number) => [CHEVRON(24), CHEVRON(32), CHEVRON(16)].slice(0, n).join("");
const stars = (n: number) => (n === 1 ? STAR(32, 31, 16) : n === 2 ? STAR(23, 33, 11) + STAR(41, 29, 11) : STAR(32, 22, 10) + STAR(20, 40, 9) + STAR(44, 40, 9));
const BOLT = "M36 8L18 34h12l-4 22l20-28H34z";
const GEM = "M20 22l6-8h12l6 8l-12 26z";
const genericGem = (mat: string, n: number, large: boolean, id: string) =>
  emblem(GEM, mat, large, id) + (large ? `<path d="M20 22h24M26 14l6 8l6-8M32 22v26" fill="none" stroke="${INK}" stroke-width=".8" opacity=".45"/>` : "") + sparkle(n, large);

const GENERIC_ITEM: Record<ItemKey, (large: boolean, id: string) => string> = {
  plastic: (l, id) => emblem(chevrons(1), "plastic", l, id),
  feather: (l, id) => emblem(chevrons(2), "feather", l, id),
  tube: (l, id) => emblem(chevrons(3), "tube", l, id),
  wooden: (l, id) => emblem(stars(1), "wood", l, id),
  steel: (l, id) => emblem(stars(2), "steel", l, id),
  aluminium: (l, id) => emblem(stars(3), "alu", l, id),
  carbon: (l, id) => emblem(BOLT, "carbon", l, id),
  pro: (l, id) => `<g transform="translate(32 32) scale(.82) translate(-32 -32)">${emblem(FLAME, "pro", l, id)}</g>`,
  silver: (l, id) => genericGem("silver", 1, l, id),
  golden: (l, id) => genericGem("gold", 2, l, id),
  platinum: (l, id) => genericGem("platinum", 3, l, id),
  diamond: (l, id) => genericGem("diamond", 4, l, id) + crownShape(23, 2, 18, 9, C.bronzeLight, l),
};

/** A top seat in the plain set: the crest with a star, crowned for the first seat, with a laurel for the second. */
function genericSeat(alpha: boolean, large: boolean, id: string): string {
  let s = `<path d="${CREST}" fill="${alpha ? C.navyDark : C.navy}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}" stroke-linejoin="round"/>`;
  s += `<path d="${CREST}" fill="none" stroke="${alpha ? C.bronzeLight : C.steel}" stroke-width="${large ? 1.2 : 1.8}" transform="translate(32 32) scale(.88) translate(-32 -32)" stroke-linejoin="round"/>`;
  s += `<defs>${grad(id + "s", alpha ? M.gold : M.silver)}</defs><path d="${STAR(32, 34, 14)}" fill="url(#${id}s)" stroke="${INK}" stroke-width="${large ? 1.6 : 2.6}" stroke-linejoin="round"/>`;
  if (alpha) s += crownShape(24, 6, 16, 9, C.bronzeLight, large);
  else s += `<path d="M17 46C13 41 13 34 16 28M47 46c4-5 4-12 1-18" fill="none" stroke="${C.steelLight}" stroke-width="${large ? 1.6 : 2.4}" stroke-linecap="round"/>`;
  return s;
}

/**
 * The plain set in the club's colours: each of the drawings' house colours
 * gets a class (art-deep, art-light, art-cool, art-warm, for fill and
 * stroke), which the app's stylesheet paints from the club's theme. The
 * colour stays in the markup as the fallback.
 */
const ROLE: Record<string, string> = Object.fromEntries(
  ([
    [[C.navy, C.navyDark, C.navyMid], "deep"],
    [[C.cream, C.creamDark, "#eef4f8", "#fbf3e4"], "light"],
    [[C.steel, C.steelLight], "cool"],
    [[C.bronze, C.bronzeDark, C.bronzeLight], "warm"],
  ] as const).flatMap(([hexes, role]) => hexes.map((h) => [h.toLowerCase(), role])),
);
export function clubColoured(markup: string): string {
  return markup.replace(/<(path|circle|ellipse|rect|stop|g)\b([^>]*?)(\/?)>/g, (tag, name: string, attrs: string, close: string) => {
    const classes: string[] = [];
    for (const m of attrs.matchAll(/\b(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6})"/g)) {
      const role = ROLE[m[2].toLowerCase()];
      if (role) classes.push(`art-${m[1] === "stroke" ? "s" : "f"}-${role}`);
    }
    return classes.length ? `<${name}${attrs} class="${classes.join(" ")}"${close}>` : tag;
  });
}

// ── Kit add-ons: little round badges along the bottom ─────────────────
const KIT_GLYPH: Record<KitKey, string> = {
  shoes: `<path d="M-3.6 1.2V-.8c0-.9.6-1.5 1.3-1.5c.8 0 1.2.7 1.9.7c.9 0 1.3-1.9 2.4-1.9c.8 0 1 .8 1.7 1.4c1.3 1.1 2.1 1.4 2.1 2.6v.7z" fill="${C.cream}"/><path d="M-4 1.2h8.4v1.1h-8.4z" fill="${C.bronzeLight}"/>`,
  jersey: `<path d="M-1.6-3.6l-2.6 1.3l-1 2.2l1.6.8l.7-1.2V3.6h5.8V-.5l.7 1.2l1.6-.8l-1-2.2l-2.6-1.3c-.2.8-.9 1.2-1.6 1.2s-1.4-.4-1.6-1.2z" fill="${C.cream}"/>`,
  bag: `<rect x="-4.2" y="-1.6" width="8.4" height="5" rx="1.8" fill="${C.cream}"/><path d="M-2 -1.6c0-1.2 1-2 2-2s2 .8 2 2" fill="none" stroke="${C.cream}" stroke-width="1"/><path d="M-3.4 .2h6.8" stroke="${C.bronze}" stroke-width=".7"/>`,
  trophy: `<path d="M-2.6-3.6h5.2v1.8c0 1.6-1.2 2.8-2.6 2.8s-2.6-1.2-2.6-2.8z" fill="${C.bronzeLight}"/><path d="M-.6 1h1.2v1.4h-1.2zM-2 2.4h4v1.2h-4z" fill="${C.bronzeLight}"/>`,
};

function kitBadges(kit: KitKey[], league: League, large: boolean): string {
  if (!kit.length) return "";
  const y = league === 4 ? 50.5 : league === 3 ? 49 : 51;
  if (!large) {
    // Bold set: bronze dots, one per item.
    const gap = 5.5;
    const x0 = 32 - ((kit.length - 1) * gap) / 2;
    return kit.map((_, i) => `<circle cx="${x0 + i * gap}" cy="${y + 1}" r="2.4" fill="${C.bronze}" stroke="${INK}" stroke-width="1"/>`).join("");
  }
  const gap = 13;
  const x0 = 32 - ((kit.length - 1) * gap) / 2;
  return kit
    .map(
      (k, i) =>
        `<g transform="translate(${x0 + i * gap} ${y})"><circle r="6.3" fill="${C.navy}" stroke="${C.cream}" stroke-width="1.2"/><g transform="scale(1.15)">${KIT_GLYPH[k]}</g></g>`,
    )
    .join("");
}

/** Inner SVG markup for a rank on the ladder. `id` must be unique on the page. `set`: whose drawings (see ArtSet). */
export function rankArt(index: number, size: ArtSize, id: string, set: ArtSet = "three-wolves"): string {
  const r = LADDER[index];
  const large = size === "lg";
  const plain = set === "luvallplay";
  let s = frame(r.league, large);
  s += `<g transform="${INSET[r.league]}">${(plain ? GENERIC_ITEM : ITEM_ART)[r.item](large, id)}</g>`;
  if (r.league === 4) s += ribbon(large);
  // League 1 has no kit; show the step with pips there.
  if (r.league === 1 && large) {
    const gap = 5.2;
    const x0 = 32 - ((r.steps - 1) * gap) / 2;
    for (let i = 0; i < r.steps; i++) {
      const on = i < r.step;
      s += `<circle cx="${x0 + i * gap}" cy="53" r="1.6" fill="${on ? C.bronze : "none"}" stroke="${on ? C.bronze : INK}" stroke-width=".8" ${on ? "" : 'opacity=".35"'}/>`;
    }
  }
  s += kitBadges(r.kit, r.league, large);
  return plain ? clubColoured(s) : s;
}

// ── Wolf seats ────────────────────────────────────────────────────────
function wolfHead(gold: boolean, large: boolean, id: string): string {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "w", gold ? M.gold : M.silver)}</defs>`;
  s += `<path d="M32 55L20.5 42L15 23.5L13.5 7.5L25.5 17.5H38.5L50.5 7.5L49 23.5L43.5 42Z" fill="url(#${id}w)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M32 18.5L27.5 30L32 49L36.5 30Z" fill="${gold ? C.cream : "#fff"}" stroke="${INK}" stroke-width="${large ? 1 : 1.8}" stroke-linejoin="round"/>`;
  s += `<path d="M21 30.5l5.5 2.2l.6 2.8l-5-2.2zM43 30.5l-5.5 2.2l-.6 2.8l5-2.2z" fill="${C.navy}"/>`;
  if (large)
    s += `<path d="M17.5 12.5l5 6M46.5 12.5l-5 6" stroke="${INK}" stroke-width="1" opacity=".5"/><path d="M29.5 49.5l2.5 2.2l2.5-2.2" fill="none" stroke="${C.navy}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

export function crownShape(x: number, y: number, w: number, h: number, fill: string, large: boolean): string {
  const sw = large ? 1.6 : 2.6;
  const d = `M${x} ${y + h}l${-w * 0.04} ${-h * 0.78}l${w * 0.27} ${h * 0.38}l${w * 0.27} ${-h * 0.6}l${w * 0.27} ${h * 0.6}l${w * 0.27} ${-h * 0.38}l${-w * 0.04} ${h * 0.78}z`;
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

const CREST = "M32 3L58 14L54 42L32 61L10 42L6 14Z";
export function seatArt(seat: "alpha" | "silver", size: ArtSize, id: string, set: ArtSet = "three-wolves"): string {
  const large = size === "lg";
  const alpha = seat === "alpha";
  if (set === "luvallplay") return clubColoured(genericSeat(alpha, large, id));
  let s = `<path d="${CREST}" fill="${alpha ? C.navyDark : C.navy}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}" stroke-linejoin="round"/>`;
  s += `<path d="${CREST}" fill="none" stroke="${alpha ? C.bronzeLight : C.steel}" stroke-width="${large ? 1.2 : 1.8}" transform="translate(32 32) scale(.88) translate(-32 -32)" stroke-linejoin="round"/>`;
  s += `<g transform="translate(32 ${alpha ? 35 : 33}) scale(${alpha ? 0.66 : 0.72}) translate(-32 -32)" color="${C.cream}">${wolfHead(alpha, large, id)}</g>`;
  if (alpha) s += crownShape(24, 6, 16, 9, C.bronzeLight, large);
  return s;
}

// ── Crowns, bonuses, achievements ─────────────────────────────────────
const medal = (inner: string, ring: string, large: boolean, fill: string = C.cream) =>
  `<circle cx="32" cy="32" r="27" fill="${fill}" stroke="${INK}" stroke-width="${large ? 2.2 : 3.6}"/><circle cx="32" cy="32" r="22.5" fill="none" stroke="${ring}" stroke-width="${large ? 1.4 : 2}"/>${inner}`;

function trophy(large: boolean, id: string, laurel = false): string {
  const sw = large ? 1.8 : 3;
  let s = `<defs>${grad(id + "t", M.gold)}</defs>`;
  s += `<path d="M21 13.5c-6 0-7.5 3-7.5 5.5c0 4.8 4.4 8 9.4 8.6M43 13.5c6 0 7.5 3 7.5 5.5c0 4.8-4.4 8-9.4 8.6" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`;
  s += `<path d="M20 11.5h24v8c0 7.4-5.4 13-12 13s-12-5.6-12-13z" fill="url(#${id}t)" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  s += `<path d="M29.5 32.5h5v6h-5z" fill="url(#${id}t)" stroke="${INK}" stroke-width="${sw * 0.8}"/>`;
  s += `<path d="M22.5 44.5c0-3.4 2.6-6 6-6h7c3.4 0 6 2.6 6 6v2h-19z" fill="${C.navy}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  if (large) s += `<path d="M32 16.5l1.4 2.8l3 .4l-2.2 2.1l.5 3l-2.7-1.4l-2.7 1.4l.5-3l-2.2-2.1l3-.4z" fill="#fff" opacity=".9"/>`;
  if (laurel) {
    s += `<path d="M15 50C8 44 6 34 9 24M49 50c7-6 9-16 6-26" fill="none" stroke="${C.bronze}" stroke-width="${large ? 1.4 : 2.2}" stroke-linecap="round"/>`;
  }
  return s;
}

export type CrownKind = "crown-pair" | "pack-leader" | "season-champion";
export function crownArt(kind: CrownKind, size: ArtSize, id: string, set: ArtSet = "three-wolves"): string {
  const large = size === "lg";
  if (set === "luvallplay") {
    // The most games: a pennant on its pole, not a paw.
    if (kind === "pack-leader")
      return clubColoured(medal(`<path d="M24 50V14" stroke="${INK}" stroke-width="${large ? 2.4 : 3.4}" stroke-linecap="round"/><path d="M25 15l20 6.5l-20 6.5z" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="${large ? 1.8 : 2.6}" stroke-linejoin="round"/>`, C.steel, large));
    return clubColoured(crownArt(kind, size, id));
  }
  if (kind === "crown-pair")
    return medal(`${crownShape(17, 19, 30, 17, C.bronzeLight, large)}<circle cx="26" cy="45" r="3.4" fill="${C.navy}"/><circle cx="38" cy="45" r="3.4" fill="${C.navy}"/>`, C.bronze, large);
  if (kind === "pack-leader")
    return medal(
      `<ellipse cx="32" cy="38" rx="8.5" ry="7.5" fill="${C.navy}"/><ellipse cx="21.5" cy="28" rx="3.4" ry="4.4" transform="rotate(-20 21.5 28)" fill="${C.navy}"/><ellipse cx="28" cy="22" rx="3.4" ry="4.6" transform="rotate(-6 28 22)" fill="${C.navy}"/><ellipse cx="36" cy="22" rx="3.4" ry="4.6" transform="rotate(6 36 22)" fill="${C.navy}"/><ellipse cx="42.5" cy="28" rx="3.4" ry="4.4" transform="rotate(20 42.5 28)" fill="${C.navy}"/>`,
      C.steel,
      large,
    );
  return medal(`<g transform="translate(32 33) scale(.7) translate(-32 -32)">${trophy(large, id, true)}</g>`, C.bronze, large, "#fbf3e4");
}

export type BonusKind = "giant-killer" | "new-rival" | "hot-streak" | "crown-bounty";
const line = (d: string, extra = "") =>
  `<g fill="none" stroke="${INK}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${d}</g>${extra}`;
const FLAME = "M32 58c-11 0-18-7.5-18-17c0-9 6-13 8-21c4 4 4 8 4 11c4-6 3-14 0-24c12 6 22 17 22 32c0 11-6 19-16 19z";
export function bonusArt(kind: BonusKind): string {
  switch (kind) {
    case "giant-killer":
      return line(`<path d="M8 52L26 18L36 34L42 26L56 52Z"/><path d="M26 18V7l9 4l-9 4"/>`, `<path d="M26 7l9 4l-9 4z" fill="${C.bronze}"/>`);
    case "new-rival":
      return line(
        `<circle cx="22" cy="24" r="8"/><path d="M8 52c0-8 6-13 14-13s14 5 14 13"/><circle cx="44" cy="20" r="6"/><path d="M40 33c8 0 14 5 14 13"/>`,
        `<circle cx="51" cy="13" r="7" fill="${C.bronze}"/><path d="M51 9.5v7M47.5 13h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
      );
    case "hot-streak":
      return `<path d="${FLAME}" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M32 52c-5 0-8-3.5-8-8c0-4.4 3-6 4.4-10c3 3 4.6 5 4.6 8c2-2 2.8-4.4 2.8-6.6c3 2.6 4.2 5.8 4.2 9.4c0 4.4-3 7.2-8 7.2z" fill="${C.bronze}"/>`;
    case "crown-bounty":
      return `${crownShape(8, 18, 40, 26, C.bronzeLight, false)}<circle cx="49" cy="46" r="11" fill="${C.navy}" stroke="${INK}" stroke-width="3"/><path d="M49 40v12M43 46h12" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`;
  }
}

const g = (d: string, sw = 3.4) => `<g fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
export function achievementArt(key: AchievementKey, size: ArtSize, id: string, set: ArtSet = "three-wolves"): string {
  const s = twAchievementArt(key, size, id);
  return set === "luvallplay" ? clubColoured(s) : s;
}

function twAchievementArt(key: AchievementKey, size: ArtSize, id: string): string {
  const large = size === "lg";
  const inner: Record<AchievementKey, () => string> = {
    "first-blood": () =>
      `<g transform="rotate(-35 32 32)">${g(`<path d="M27 40L21 17Q32 14 43 17L37 40z"/><path d="M27 40h10v2.5c0 3-2.2 5.5-5 5.5s-5-2.5-5-5.5z"/>`, 2.6)}</g><path d="M46 14l2 5l5 2l-5 2l-2 5l-2-5l-5-2l5-2z" fill="${C.bronze}"/>`,
    "golden-point": () =>
      `${g(`<path d="M14 46h36"/><path d="M32 46v-4"/>`, 2.6)}<circle cx="32" cy="34" r="6" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="2.6"/><path d="M22 22c4-5 8-7 10-7s6 2 10 7" fill="none" stroke="${C.bronze}" stroke-width="2.6" stroke-dasharray="3 3" stroke-linecap="round"/>`,
    "nail-biter": () =>
      g(`<path d="M22 14h20M22 50h20M24 14c0 9 8 11 8 18s-8 9-8 18M40 14c0 9-8 11-8 18s8 9 8 18"/>`, 2.8) +
      `<path d="M27 46c2-4 3.4-6 5-6s3 2 5 6z" fill="${C.bronze}"/>`,
    "social-wolf": () =>
      g(`<path d="M32 17L18 40M32 17L46 40M18 40h28M32 17v14M18 40l14-9l14 9"/>`, 2.2) +
      [[32, 17], [18, 40], [46, 40], [32, 31]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 4.2 : 5}" fill="${i === 3 ? C.bronze : C.navy}"/>`).join(""),
    "loyal-partner": () => g(`<circle cx="26" cy="32" r="10"/>`, 3.2) + `<circle cx="38" cy="32" r="10" fill="none" stroke="${C.bronze}" stroke-width="3.2"/>`,
    "giant-killer": () =>
      g(`<path d="M13 46L27 21L35 33L40 27L51 46Z"/><path d="M27 21v-8l7 3l-7 3"/>`, 2.8) + `<path d="M27 13l7 3l-7 3z" fill="${C.bronze}"/>`,
    "crown-taker": () => crownShape(17, 22, 30, 17, C.bronzeLight, true) + g(`<path d="M32 50V43M28 46.5l4-4l4 4"/>`, 2.6),
    "hot-streak": () =>
      `<g transform="translate(32 32) scale(.62) translate(-32 -32)"><path d="${FLAME}" fill="${C.bronzeLight}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></g>`,
    "iron-wolf": () =>
      g(`<rect x="17" y="19" width="30" height="27" rx="4"/><path d="M17 27h30M24 15v7M40 15v7"/>`, 2.6) +
      `<path d="M24 36l5 5l11-10" fill="none" stroke="${C.bronze}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    polished: () =>
      `<g transform="translate(32 32) scale(.62) translate(-32 -32)">${racket({ mat: "gold", frameW: 3, grip: C.navy }, true, id)}</g><path d="M44 14l2 5l5 2l-5 2l-2 5l-2-5l-5-2l5-2z" fill="${C.bronzeLight}" stroke="${C.bronzeDark}" stroke-width=".6"/>`,
  };
  return medal(inner[key](), C.bronze, large);
}
