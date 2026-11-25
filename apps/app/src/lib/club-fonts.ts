// A club's own fonts (its theme's `fonts`, files on its website): added to
// the page when its look applies, removed when another club's look does.
// The browser downloads one only when text uses it. The page's policy
// allows fonts from the club's host (vite.config.ts, font-src).
export type ClubFont = { family: string; src: string; weight: number; style: "normal" | "italic" };

const added = new Map<string, FontFace>();
const key = (f: ClubFont) => `${f.family}|${f.weight}|${f.style}|${f.src}`;

export function applyClubFonts(fonts: readonly ClubFont[]): void {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const wanted = new Set(fonts.map(key));
  for (const [k, face] of added) {
    if (!wanted.has(k)) {
      document.fonts.delete(face);
      added.delete(k);
    }
  }
  for (const f of fonts) {
    const k = key(f);
    if (added.has(k) || !/^https?:\/\//.test(f.src)) continue;
    const face = new FontFace(f.family, `url(${JSON.stringify(f.src)})`, { weight: String(f.weight), style: f.style, display: "swap" });
    document.fonts.add(face);
    added.set(k, face);
  }
}
