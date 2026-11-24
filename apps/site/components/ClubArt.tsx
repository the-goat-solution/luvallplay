// Vector illustrations for the club pages, drawn in Luvallplay's colours.
// They are simplified drawings, not screenshots: no club's name or brand,
// and no words, so they read the same in English and Vietnamese. Numbers
// are samples. Each sits inside an element that carries its own label.

import type { ReactNode } from "react";

const G = "#0e6b4f"; // court green
const L = "#d4f23c"; // smash lime
const N = "#0b1b2b"; // net navy
const C = "#ff6b4a"; // rally coral
const W = "#ffffff";
const S = "#f4f7f5"; // soft surface
const B = "#d5ddd9"; // placeholder bar
const E = "#e1e8e4"; // edge

const bar = (x: number, y: number, w: number, h = 10, fill = B, o?: number) => (
  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={o} />
);

/** The admin area on a desktop screen and on a phone. */
export function AdminArt() {
  const navW = [96, 70, 84, 62, 90, 74, 58, 80];
  const tiles = [["24", S], ["0", S], ["3", "#f1f9cf"], ["4", S]] as const;
  const chart = [46, 70, 58, 88, 64, 96, 78, 104];
  return (
    <svg className="admin-art" viewBox="0 0 1000 600" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      {/* Desktop */}
      <rect x="2" y="2" width="816" height="536" rx="22" fill={W} />
      <path d="M2 24a22 22 0 0 1 22-22h772a22 22 0 0 1 22 22v22H2z" fill="#eef3f0" />
      {[26, 46, 66].map((x) => <circle key={x} cx={x} cy="24" r="6" fill="#c5d1cb" />)}
      <rect x="290" y="14" width="240" height="20" rx="10" fill={W} />
      <path d="M2 46h178v490H24a22 22 0 0 1-22-22z" fill={S} />
      <circle cx="38" cy="80" r="16" fill={G} />
      <circle cx="38" cy="80" r="6" fill={L} />
      {bar(62, 74, 84, 12, N, 0.85)}
      {navW.map((w, i) => {
        const y = 120 + i * 38 + (i > 2 ? 14 : 0) + (i > 5 ? 14 : 0);
        const on = i === 0;
        return (
          <g key={i}>
            {on ? <rect x="14" y={y - 9} width="152" height="30" rx="10" fill={G} /> : null}
            <rect x="26" y={y - 1} width="14" height="14" rx="4" fill={on ? L : "#c5d1cb"} />
            {bar(50, y + 1, w, 10, on ? W : B, on ? 0.95 : 1)}
            {i === 4 || i === 6 ? <circle cx="150" cy={y + 6} r="9" fill={C} /> : null}
          </g>
        );
      })}
      {bar(200, 66, 150, 18, N)}
      {bar(200, 96, 280, 10)}
      <rect x="640" y="62" width="150" height="32" rx="16" fill={L} />
      {bar(668, 73, 94, 10, N, 0.85)}

      <rect x="200" y="122" width="590" height="152" rx="18" fill={G} />
      {bar(224, 144, 84, 10, L)}
      {bar(224, 164, 190, 18, W)}
      {bar(224, 192, 124, 10, W, 0.6)}
      <rect x="688" y="142" width="80" height="26" rx="13" fill={L} />
      {bar(704, 151, 48, 8, N, 0.8)}
      {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={236 + i * 27} cy="240" r="10" fill={W} />)}
      <line x1="618" y1="226" x2="618" y2="254" stroke={W} strokeOpacity=".35" strokeWidth="2" />
      {[0, 1, 2].map((i) => <circle key={i} cx={640 + i * 27} cy="240" r="9" stroke={L} strokeWidth="3" strokeDasharray="4 3" />)}

      {tiles.map(([n, fill], i) => {
        const x = 200 + i * 152;
        return (
          <g key={i}>
            <rect x={x} y="292" width="134" height="88" rx="14" fill={fill} />
            {bar(x + 16, 308, 62, 8)}
            <text x={x + 16} y="360" fill={N} fontSize="34" fontWeight="700" fontFamily="var(--font-display), sans-serif">{n}</text>
          </g>
        );
      })}

      <rect x="200" y="398" width="290" height="122" rx="14" fill={W} stroke={E} strokeWidth="2" />
      {bar(218, 414, 90, 8)}
      {chart.map((h, i) => <rect key={i} x={222 + i * 32} y={504 - h * 0.7} width="18" height={h * 0.7} rx="5" fill={i === chart.length - 1 ? L : G} opacity={i === chart.length - 1 ? 1 : 0.35 + i * 0.08} />)}
      <rect x="506" y="398" width="284" height="122" rx="14" fill={W} stroke={E} strokeWidth="2" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx="532" cy={426 + i * 34} r="10" fill={i === 2 ? G : C} />
          {bar(552, 421 + i * 34, [120, 96, 136][i])}
          <path d={`M724 ${420 + i * 34}l6 6-6 6`} stroke={N} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      <rect x="2" y="2" width="816" height="536" rx="22" stroke={E} strokeWidth="2" />

      {/* Phone */}
      <rect x="760" y="148" width="232" height="444" rx="38" fill={N} />
      <rect x="772" y="160" width="208" height="420" rx="28" fill="#fafaf7" />
      <rect x="846" y="168" width="60" height="8" rx="4" fill={N} />
      {bar(790, 194, 84, 14, N)}
      <circle cx="954" cy="201" r="11" fill="#e3efe9" />
      <rect x="788" y="222" width="176" height="104" rx="18" fill={G} />
      {bar(804, 238, 60, 8, L)}
      {bar(804, 254, 110, 12, W)}
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={810 + (i % 6) * 22} cy={290 + Math.floor(i / 6) * 20} r="7" fill={i > 9 ? "none" : W} stroke={i > 9 ? L : "none"} strokeWidth="2.5" />
      ))}
      {[["24", 788], ["3", 880]].map(([n, x]) => (
        <g key={n}>
          <rect x={x} y="338" width="84" height="66" rx="14" fill={W} stroke={E} strokeWidth="2" />
          {bar(Number(x) + 12, 350, 40, 7)}
          <text x={Number(x) + 12} y="392" fill={N} fontSize="26" fontWeight="700" fontFamily="var(--font-display), sans-serif">{n}</text>
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="788" y={416 + i * 36} width="176" height="28" rx="10" fill={W} stroke={E} strokeWidth="2" />
          <circle cx="804" cy={430 + i * 36} r="6" fill={i === 0 ? C : G} />
          {bar(818, 425 + i * 36, [96, 74, 110][i], 9)}
        </g>
      ))}
      <rect x="788" y="528" width="176" height="38" rx="19" fill={W} stroke={E} strokeWidth="2" />
      <rect x="794" y="534" width="58" height="26" rx="13" fill={G} />
      {[880, 912, 944].map((x) => <circle key={x} cx={x} cy="547" r="5" fill="#c5d1cb" />)}
    </svg>
  );
}

const card = (x: number, y: number, w: number, h: number, rx = 14) => <rect x={x} y={y} width={w} height={h} rx={rx} fill={W} stroke={E} strokeWidth="2" />;
const check = (cx: number, cy: number, r = 16, fill = L, stroke = N) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <path d={`M${cx - r * 0.4} ${cy + r * 0.02}l${r * 0.28} ${r * 0.3} ${r * 0.52}-${r * 0.6}`} stroke={stroke} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round" />
  </g>
);
const person = (cx: number, cy: number, r: number, fill: string, head = W) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <circle cx={cx} cy={cy - r * 0.18} r={r * 0.32} fill={head} />
    <path d={`M${cx - r * 0.55} ${cy + r * 0.62}a${r * 0.55} ${r * 0.5} 0 0 1 ${r * 1.1} 0`} fill={head} />
  </g>
);

const SCHEMES: [string, string][] = [["#0e6b4f", "#d4f23c"], ["#1e3a8a", "#fbbf24"], ["#be123c", "#fcd34d"], ["#6d28d9", "#6ee7b7"]];

const ART: Record<string, () => ReactNode> = {
  sessions: () => (
    <>
      {card(46, 18, 188, 124)}
      <path d="M46 32a14 14 0 0 1 14-14h160a14 14 0 0 1 14 14v12H46z" fill={G} />
      {[86, 194].map((x) => <rect key={x} x={x} y="10" width="8" height="18" rx="4" fill={L} />)}
      {Array.from({ length: 21 }, (_, i) => {
        const x = 62 + (i % 7) * 23;
        const y = 56 + Math.floor(i / 7) * 26;
        const fill = i === 9 ? L : i === 16 ? C : [2, 4, 11, 18].includes(i) ? G : "#e8eeeb";
        return <rect key={i} x={x} y={y} width="16" height="16" rx="5" fill={fill} />;
      })}
      {check(232, 118, 18)}
    </>
  ),
  fees: () => (
    <>
      <g transform="rotate(-10 86 82)">
        <rect x="40" y="46" width="92" height="66" rx="14" fill={L} />
        <path d="M86 94c-14-9-18-15-18-21a8 8 0 0 1 18-4 8 8 0 0 1 18 4c0 6-4 12-18 21z" fill={N} />
      </g>
      <rect x="100" y="40" width="92" height="66" rx="14" fill={G} />
      <circle cx="146" cy="73" r="16" fill="none" stroke={W} strokeWidth="4" />
      {bar(112, 52, 16, 6, W, 0.6)}
      {bar(164, 88, 16, 6, W, 0.6)}
      <g transform="rotate(9 200 92)">
        <rect x="156" y="58" width="96" height="64" rx="12" fill={N} />
        <rect x="156" y="72" width="96" height="12" fill="#2a3d51" />
        <rect x="170" y="94" width="22" height="16" rx="4" fill={L} />
        {bar(200, 100, 38, 6, W, 0.5)}
      </g>
    </>
  ),
  memberships: () => (
    <>
      <g transform="rotate(-6 130 82)">
        <rect x="46" y="34" width="168" height="100" rx="16" fill={G} />
        <rect x="46" y="114" width="168" height="20" rx="0" fill={L} />
        <path d="M46 114h168v4a16 16 0 0 1-16 16H62a16 16 0 0 1-16-16z" fill={L} />
        {person(88, 72, 22, "#2b7d64")}
        {bar(122, 60, 70, 10, W)}
        {bar(122, 80, 48, 8, W, 0.6)}
      </g>
      {check(220, 40, 20)}
      <path d="M232 118a24 24 0 1 1-8-30" stroke={G} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M216 82l10 6-4 11" stroke={G} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  brand: () => (
    <>
      {SCHEMES.map(([p, a], i) => (
        <g key={p} transform={`translate(${34 + i * 54} ${i % 2 ? 26 : 16})`}>
          <rect width="46" height="96" rx="12" fill={W} stroke={E} strokeWidth="2" />
          <path d="M0 12A12 12 0 0 1 12 0h22a12 12 0 0 1 12 12v18H0z" fill={p} />
          {bar(8, 40, 30, 6)}
          {bar(8, 52, 22, 6)}
          <rect x="8" y="72" width="30" height="12" rx="6" fill={a} />
        </g>
      ))}
    </>
  ),
  admin: () => (
    <>
      {card(36, 22, 208, 118)}
      {bar(52, 36, 70, 10, N)}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={52 + i * 62} y="56" width="52" height="34" rx="8" fill={i === 2 ? "#f1f9cf" : S} />
          {bar(60 + i * 62, 64, 26, 5)}
          {bar(60 + i * 62, 76, 18, 8, N, 0.8)}
        </g>
      ))}
      {[18, 26, 20, 32, 28].map((h, i) => <rect key={i} x={56 + i * 16} y={126 - h} width="10" height={h} rx="3" fill={G} opacity={0.4 + i * 0.15} />)}
      {bar(150, 104, 76, 8)}
      {bar(150, 118, 54, 8)}
      <circle cx="230" cy="30" r="20" fill={N} />
      <path d="M222 36h16l-2-3v-6a6 6 0 0 0-12 0v6z" fill={W} />
      <circle cx="243" cy="18" r="7" fill={C} />
    </>
  ),
  modules: () => (
    <>
      {[0, 1, 2].map((i) => {
        const on = i !== 1;
        const y = 22 + i * 40;
        return (
          <g key={i}>
            {card(40, y, 200, 32, 10)}
            <rect x="50" y={y + 7} width="18" height="18" rx="5" fill={[G, "#c5d1cb", L][i]} />
            {bar(78, y + 12, [80, 64, 92][i], 8)}
            <rect x="192" y={y + 7} width="38" height="18" rx="9" fill={on ? G : "#c5d1cb"} />
            <circle cx={on ? 221 : 201} cy={y + 16} r="7" fill={W} />
          </g>
        );
      })}
    </>
  ),
  members: () => (
    <>
      {[[54, "#2b7d64", 30], [140, G, 40], [226, N, 30]].map(([cx, fill, r], i) => (
        <g key={i}>
          {card(Number(cx) - 40, i === 1 ? 20 : 34, 80, i === 1 ? 118 : 96, 16)}
          {person(Number(cx), i === 1 ? 64 : 70, Number(r) * 0.8, String(fill))}
          {bar(Number(cx) - 22, i === 1 ? 112 : 106, 44, 8, i === 1 ? L : B)}
        </g>
      ))}
      <circle cx="170" cy="34" r="12" fill={L} />
      <path d="M164 35l4 4 8-8" stroke={N} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  money: () => (
    <>
      {card(30, 20, 132, 120)}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="48" cy={44 + i * 26} r="7" fill={i === 2 ? C : G} />
          {bar(62, 40 + i * 26, [50, 38, 46, 32][i], 8)}
          {bar(124, 40 + i * 26, 24, 8, i === 2 ? C : G, 0.7)}
        </g>
      ))}
      <path d="M176 30h76v104l-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6z" fill={W} stroke={E} strokeWidth="2" />
      {[34, 50, 42, 64].map((h, i) => <rect key={i} x={188 + i * 15} y={112 - h} width="10" height={h} rx="3" fill={i === 3 ? L : G} />)}
    </>
  ),
  start: () => (
    <>
      <path d="M44 120C90 120 84 56 140 64s52 52 96-20" stroke={G} strokeWidth="4" strokeDasharray="2 9" strokeLinecap="round" fill="none" />
      {[[44, 120, "1"], [140, 64, "2"]].map(([x, y, n]) => (
        <g key={n}>
          <circle cx={x} cy={y} r="18" fill={G} />
          <text x={x} y={Number(y) + 7} textAnchor="middle" fill={W} fontSize="20" fontWeight="700" fontFamily="var(--font-display), sans-serif">{n}</text>
        </g>
      ))}
      <circle cx="236" cy="44" r="22" fill={L} />
      <path d="M230 56V30l14 6-14 6" stroke={N} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  where: () => (
    <>
      {[54, 40, 26].map((r, i) => <circle key={r} cx="140" cy="112" r={r * 1.6} stroke={G} strokeOpacity={0.15 + i * 0.12} strokeWidth="3" fill="none" />)}
      <path d="M140 118c-20-24-30-38-30-52a30 30 0 0 1 60 0c0 14-10 28-30 52z" fill={C} />
      <circle cx="140" cy="66" r="11" fill={W} />
      {card(196, 24, 56, 36, 10)}
      {bar(206, 36, 36, 7)}
      {bar(206, 48, 22, 6, G)}
      {card(28, 84, 56, 36, 10)}
      {bar(38, 96, 36, 7)}
      {bar(38, 108, 22, 6, L)}
    </>
  ),
};

export const ART_NAMES = Object.keys(ART);

export function FeatureArt({ name, className = "" }: { name: string; className?: string }) {
  const draw = ART[name];
  if (!draw) return null;
  return (
    <span className={`fart ${className}`} aria-hidden="true">
      <svg viewBox="0 0 280 160" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">{draw()}</svg>
    </span>
  );
}

/** The admin drawing with its caption, as one labelled figure. */
export function AdminFigure({ caption }: { caption: string }) {
  return (
    <figure className="admin-fig">
      <div role="img" aria-label={caption}><AdminArt /></div>
      <figcaption className="phone-cap">{caption}</figcaption>
    </figure>
  );
}
