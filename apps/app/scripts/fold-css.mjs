// Safari's fold-aware CSS (`@media (horizontal-viewport-segments: 2)` and
// `env(viewport-segment-*)`) is not in WKWebView, which is what the iOS store
// app runs the page in. The shell tells the page where the fold is instead
// (lib/native/fold.ts sets `data-fold` and `--seg-*` on <html>), and these
// generated copies apply the very same rules to that:
//
//   @media (horizontal-viewport-segments: 2) { X }
//     becomes
//   :where(:root[data-fold="vertical"]) { X }   (CSS nesting, zero specificity)
//
// with `env(viewport-segment-width 0 0, 50vw)` read as `var(--seg-0-width, 50vw)`.
// Edit the media blocks in app.css / stage.css, then run `pnpm --filter app fold:css`;
// tests/fold.test.ts fails while a copy is out of date.
import { readFileSync, writeFileSync } from "node:fs";

const OPEN = "@media (horizontal-viewport-segments: 2) {";

/** The bodies of every `@media (horizontal-viewport-segments: 2) { … }` block, by brace matching. */
export function mediaBodies(css) {
  const bodies = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(OPEN, from);
    if (at < 0) return bodies;
    let depth = 1;
    let i = at + OPEN.length;
    for (; i < css.length && depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    if (depth !== 0) throw new Error("unbalanced braces after a viewport-segments media query");
    bodies.push(css.slice(at + OPEN.length, i - 1));
    from = i;
  }
}

/** `env(viewport-segment-width 0 0, 50vw)` → `var(--seg-0-width, 50vw)` (the second index is always 0: one row of segments). */
export function segmentVars(css) {
  return css.replace(/env\(viewport-segment-(left|right|top|bottom|width|height) (\d) 0,\s*([^)]+)\)/g, "var(--seg-$2-$1, $3)");
}

export function foldCopy(css, source) {
  const bodies = mediaBodies(css);
  if (!bodies.length) throw new Error(`${source}: no viewport-segments media query to copy`);
  const head = `/* GENERATED from ${source} by scripts/fold-css.mjs: do not edit; run \`pnpm --filter app fold:css\`. */\n`;
  const note = `/* The fold rules, for the iOS store app (no viewport segments in WKWebView): the shell sets data-fold on <html>. */\n`;
  return head + note + bodies.map((b) => `:where(:root[data-fold="vertical"]) {${segmentVars(b)}}\n`).join("\n");
}

export const COPIES = [
  ["src/styles/app.css", "src/styles/fold-app.css"],
  ["src/styles/stage.css", "src/styles/fold-stage.css"],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [from, to] of COPIES) writeFileSync(to, foldCopy(readFileSync(from, "utf8"), from.replace("src/styles/", "")));
  console.log("fold copies written");
}
