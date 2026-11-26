// The performance budget (build plan §4.4): what the first screen needs.
//
// - JavaScript: at most 150 KB gzipped for the app shell (the entry script
//   and the chunks it preloads) plus the Home screen (its chunk and what
//   that imports), because Home is what a signed-in person lands on.
// - CSS: the stylesheets index.html links, gzipped.
// - Fonts: Luvallplay's own (the Latin files of the bundled weights; a
//   browser fetches only the ones the text on screen uses). woff2 is
//   already compressed, so the files' own sizes count.
//
// Other screens are separate chunks and are reported, not counted.
//
//   pnpm --filter app build && pnpm --filter app budget [dist-dir]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BUDGET_KB = { js: 150, css: 16, fonts: 150 };
const dist = path.resolve(import.meta.dirname, "..", process.argv[2] ?? "dist");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const kb = (file) => gzipSync(readFileSync(path.join(dist, file)), { level: 9 }).length / 1024;
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const shell = new Set();
for (const m of html.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g)) shell.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g)) shell.add(m[1]);
if (shell.size === 0) fail("No entry script found in index.html.");
if (/<script(?![^>]+src=)[^>]*>/.test(html)) fail("index.html has an inline script: the CSP forbids it.");

const assets = readdirSync(path.join(dist, "assets"));
const all = assets.filter((f) => f.endsWith(".js")).map((f) => `assets/${f}`);

/** A chunk and every chunk it imports statically (what the browser must fetch before it runs). */
function withImports(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(path.join(dist, file), "utf8");
  for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)) withImports(`assets/${m[1]}`, seen);
  return seen;
}

const homeChunk = all.find((f) => /^assets\/Home-[^/]+\.js$/.test(f));
if (!homeChunk) fail("No Home chunk found: the first screen must be its own chunk, named Home.");
const first = new Set(shell);
for (const f of withImports(homeChunk)) first.add(f);

const jsKb = [...first].reduce((sum, f) => sum + kb(f), 0);
const lazy = all.filter((f) => !first.has(f)).map((f) => [f, kb(f)]).sort((a, b) => b[1] - a[1]);

const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+\.css)"/g)].map((m) => m[1]);
const cssKb = css.reduce((sum, f) => sum + kb(f), 0);

const fonts = assets.filter((f) => /-latin-\d+-normal-[^.]+\.woff2$/.test(f)).map((f) => `assets/${f}`);
const fontsKb = fonts.reduce((sum, f) => sum + statSync(path.join(dist, f)).size / 1024, 0);

console.log(`First screen JavaScript: ${jsKb.toFixed(1)} KB gzipped (budget ${BUDGET_KB.js} KB)`);
for (const f of first) console.log(`  ${shell.has(f) ? "shell" : "home "}  ${kb(f).toFixed(1).padStart(7)} KB  ${f}`);
for (const [f, size] of lazy) console.log(`  lazy   ${size.toFixed(1).padStart(7)} KB  ${f}`);
console.log(`CSS: ${cssKb.toFixed(1)} KB gzipped (budget ${BUDGET_KB.css} KB): ${css.join(", ")}`);
console.log(`Fonts: ${fontsKb.toFixed(1)} KB in ${fonts.length} Latin woff2 files (budget ${BUDGET_KB.fonts} KB)`);

if (lazy.length < 5) fail(`Only ${lazy.length} lazy chunks: the tab screens must each be their own chunk.`);
if (css.length === 0) fail("No stylesheet found in index.html.");
if (fonts.length === 0) fail("No bundled fonts found.");
const over = [
  ["JavaScript", jsKb, BUDGET_KB.js],
  ["CSS", cssKb, BUDGET_KB.css],
  ["Fonts", fontsKb, BUDGET_KB.fonts],
].filter(([, size, budget]) => size > budget);
for (const [name, size, budget] of over) console.error(`${name} is over budget by ${(size - budget).toFixed(1)} KB.`);
if (over.length) process.exit(1);
