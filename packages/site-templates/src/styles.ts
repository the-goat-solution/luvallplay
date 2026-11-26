// The templates' styles. Colours come ONLY from the semantic tokens
// (packages/ui): no colour is written here, so every template works with
// every one of the 12 schemes and with any imported brand (build plan §7.3).
// A test holds this file to that.
//
// The club's primary colour is text (headings, links) only in light mode,
// where every theme guarantees it 4.5 : 1 on the page. In dark mode a theme
// only guarantees it as a fill (3 : 1), so text there uses the ink colour:
// --brand-text.
//
// One markup, three looks: the template is an attribute on <body>
// (data-template), and each template is a short set of overrides.
import { EXTRA_TOKENS, SEMANTIC_TOKENS, type ResolvedClubTheme } from "@luvallplay/ui";

/** The club's theme as custom properties: light by default, dark when the visitor's device asks for it. */
export function themeStyles(theme: ResolvedClubTheme): string {
  const decl = (t: Record<string, string | undefined>) =>
    [...SEMANTIC_TOKENS, ...EXTRA_TOKENS]
      .filter((k) => typeof t[k] === "string")
      .map((k) => `--${k}:${t[k]}`)
      .join(";");
  const fonts = theme.fonts
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${f.src}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`)
    .join("");
  return `${fonts}:root{color-scheme:light dark;${decl(theme.light)}}@media (prefers-color-scheme:dark){:root{${decl(theme.dark)}}}`;
}

export const BASE_CSS = `
:root{--brand-text:var(--primary);--strong:var(--primary-strong,color-mix(in oklab,var(--primary) 66%,black));--on-strong:var(--on-primary-strong,var(--on-primary));--sunken:var(--surface-sunken,color-mix(in oklab,var(--surface) 95%,var(--ink)));--soft:color-mix(in oklab,var(--primary) 9%,var(--surface-raised));--radius:1rem;--measure:68rem}
@media (prefers-color-scheme:dark){:root{--brand-text:var(--ink)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font-text);font-size:1.0625rem;line-height:1.6}
img{max-width:100%;display:block}
a{color:var(--brand-text)}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:.25rem}
h1,h2,h3{font-family:var(--font-display);line-height:1.15;margin:0;text-wrap:balance}
p{margin:0;text-wrap:pretty}
.skip{position:absolute;left:-999rem;top:.5rem;background:var(--surface-raised);color:var(--ink);padding:.75rem 1rem;border-radius:.5rem;z-index:10}
.skip:focus{left:.5rem}
.wrap{max-width:var(--measure);margin:0 auto;padding:0 1.25rem}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.875rem 1.25rem;max-width:var(--measure);margin:0 auto}
.brand{display:flex;align-items:center;gap:.75rem;font-family:var(--font-display);font-weight:700;font-size:1.125rem;color:inherit;text-decoration:none}
.brand img{height:2.5rem;width:auto}
.langs{display:flex;gap:.25rem;list-style:none;margin:0;padding:0}
.langs a{display:inline-flex;min-height:2.75rem;min-width:2.75rem;align-items:center;justify-content:center;padding:0 .625rem;border-radius:.5rem;color:inherit;text-decoration:none;font-weight:600;font-size:.875rem}
.langs a[aria-current]{background:var(--sunken)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:3rem;padding:.75rem 1.5rem;border-radius:999px;font-weight:700;text-decoration:none;border:2px solid transparent;font-size:1rem}
.btn-primary{background:var(--primary);color:var(--on-primary)}
.btn-accent{background:var(--accent);color:var(--on-accent)}
.btn-quiet{border-color:currentColor;color:inherit}
.btn:hover{filter:brightness(1.06)}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.75rem}
.hero{position:relative;background:var(--strong);color:var(--on-strong);overflow:hidden}
.hero-inner{position:relative;max-width:var(--measure);margin:0 auto;padding:4.5rem 1.25rem 5rem}
.hero h1{font-size:clamp(2.25rem,6vw,4rem)}
.hero .tagline{font-size:clamp(1.0625rem,2.2vw,1.375rem);max-width:38rem;margin-top:1rem;opacity:.92}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.28}
section{padding:4rem 0}
section:nth-of-type(even){background:var(--surface-raised)}
h2{font-size:clamp(1.625rem,3.5vw,2.25rem);color:var(--brand-text);margin-bottom:1.5rem}
.prose p+p{margin-top:1rem}
.prose{max-width:42rem}
.split{display:grid;gap:2rem;align-items:start}
@media (min-width:52rem){.split{grid-template-columns:1.1fr .9fr}}
.photos{display:grid;gap:.75rem}
.photos img,.grid img{border-radius:var(--radius);aspect-ratio:4/3;object-fit:cover;width:100%;background:var(--sunken)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem;margin:2rem 0 0;padding:0}
.facts div{background:var(--sunken);border-radius:var(--radius);padding:1rem 1.25rem}
.facts dt{font-family:var(--font-display);font-size:1.75rem;font-weight:700;color:var(--brand-text)}
.facts dd{margin:0;color:var(--ink-muted);font-size:.9375rem}
.cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));list-style:none;margin:0;padding:0}
.card{background:var(--surface-raised);border:1px solid var(--line);border-radius:var(--radius);padding:1.5rem}
section:nth-of-type(even) .card{background:var(--surface)}
.card h3{font-size:1.25rem}
.muted{color:var(--ink-muted)}
.days{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.days li{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:.875rem 1rem;border-radius:.75rem;background:var(--sunken)}
.pill{display:inline-block;padding:.125rem .625rem;border-radius:999px;background:var(--accent);color:var(--on-accent);font-size:.8125rem;font-weight:700}
.price{font-family:var(--font-display);font-size:2rem;font-weight:700;margin-top:.5rem}
.price small{font-family:var(--font-text);font-size:.9375rem;font-weight:400;color:var(--ink-muted)}
.card ul{margin:1rem 0 0;padding-left:1.125rem}
.card.featured{border:2px solid var(--primary)}
.free{background:var(--soft);border-radius:var(--radius);padding:2rem;max-width:42rem}
.free h3{font-size:1.5rem;color:var(--brand-text)}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))}
blockquote{margin:0}
.quote{font-size:1.0625rem}
.who{margin-top:1rem;font-weight:700}
details{border-bottom:1px solid var(--line);max-width:46rem}
summary{cursor:pointer;padding:1rem 0;font-weight:700;min-height:2.75rem}
details p{padding-bottom:1rem;white-space:pre-line}
.prose p,.quote{white-space:pre-line}
.contact{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.5rem 1.5rem}
.contact a{display:inline-flex;min-height:2.75rem;align-items:center;font-weight:600}
footer{background:var(--strong);color:var(--on-strong);padding:2rem 0}
footer .wrap{display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:center}
footer a{color:inherit}
.mark{font-size:.875rem;opacity:.85}
`;

export const TEMPLATE_CSS: Record<"classic" | "bold" | "minimal", string> = {
  // Classic: the photo behind the club's name, cards, alternating bands.
  classic: ``,
  // Bold: a solid block of the club's colour, big capitals, the accent everywhere it can be.
  bold: `
[data-template=bold] .hero{background:var(--primary);color:var(--on-primary)}
[data-template=bold] .hero-img{display:none}
[data-template=bold] .hero-inner{padding:5.5rem 1.25rem 6rem;border-bottom:.75rem solid var(--accent)}
[data-template=bold] .hero h1{font-size:clamp(2.75rem,9vw,6rem);text-transform:uppercase;letter-spacing:-.01em}
[data-template=bold] h2{text-transform:uppercase;letter-spacing:.04em;border-left:.5rem solid var(--accent);padding-left:.875rem}
[data-template=bold] .card{border-width:2px;border-color:var(--primary);border-radius:.375rem}
[data-template=bold] .photos img,[data-template=bold] .grid img,[data-template=bold] .facts div,[data-template=bold] .free{border-radius:.375rem}
[data-template=bold] .btn{border-radius:.375rem;text-transform:uppercase;letter-spacing:.04em}
[data-template=bold] .facts dt{font-size:2.5rem}
`,
  // Minimal: one quiet column, lines instead of cards, the photo as a picture.
  minimal: `
[data-template=minimal]{--measure:46rem}
[data-template=minimal] .hero{background:var(--surface);color:var(--ink)}
[data-template=minimal] .hero-inner{padding:3.5rem 1.25rem 2rem}
[data-template=minimal] .hero h1{color:var(--brand-text);font-size:clamp(2rem,5vw,3rem)}
[data-template=minimal] .hero-img{position:static;opacity:1;height:auto;aspect-ratio:16/9;border-radius:var(--radius);margin:2.5rem auto 0;max-width:calc(var(--measure) - 2.5rem);width:calc(100% - 2.5rem)}
[data-template=minimal] section,[data-template=minimal] section:nth-of-type(even){background:var(--surface);padding:3rem 0;border-top:1px solid var(--line)}
[data-template=minimal] h2{font-size:1.375rem;color:var(--ink)}
[data-template=minimal] .split{grid-template-columns:1fr}
[data-template=minimal] .card,[data-template=minimal] section:nth-of-type(even) .card{background:transparent;border:0;border-top:1px solid var(--line);border-radius:0;padding:1.25rem 0}
[data-template=minimal] .card.featured{border:0;border-top:2px solid var(--primary)}
[data-template=minimal] .cards{grid-template-columns:1fr;gap:0}
[data-template=minimal] footer{background:var(--surface);color:var(--ink-muted);border-top:1px solid var(--line)}
`,
};
