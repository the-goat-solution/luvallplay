// The performance budget (build plan §4.4): the app shell is at most 150 KB
// of gzipped JavaScript. The shell is what the page loads before anything is
// tapped: the entry script and the chunks it preloads. Screens are separate
// chunks and are reported, not counted.
//
//   pnpm --filter app build && pnpm --filter app budget [dist-dir]
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BUDGET_KB = 150;
const dist = path.resolve(import.meta.dirname, "..", process.argv[2] ?? "dist");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const kb = (file) => gzipSync(readFileSync(path.join(dist, file)), { level: 9 }).length / 1024;

const shell = new Set();
for (const m of html.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g)) shell.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g)) shell.add(m[1]);
if (shell.size === 0) {
  console.error("No entry script found in index.html.");
  process.exit(1);
}
if (/<script(?![^>]+src=)[^>]*>/.test(html)) {
  console.error("index.html has an inline script: the CSP forbids it.");
  process.exit(1);
}

const all = readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js")).map((f) => `assets/${f}`);
const shellKb = [...shell].reduce((sum, f) => sum + kb(f), 0);
const lazy = all.filter((f) => !shell.has(f)).map((f) => [f, kb(f)]).sort((a, b) => b[1] - a[1]);

console.log(`App shell: ${shellKb.toFixed(1)} KB gzipped JavaScript (budget ${BUDGET_KB} KB)`);
for (const f of shell) console.log(`  shell  ${kb(f).toFixed(1).padStart(7)} KB  ${f}`);
for (const [f, size] of lazy) console.log(`  lazy   ${size.toFixed(1).padStart(7)} KB  ${f}`);
if (lazy.length < 5) {
  console.error(`Only ${lazy.length} lazy chunks: the tab screens must each be their own chunk.`);
  process.exit(1);
}
if (shellKb > BUDGET_KB) {
  console.error(`Over budget by ${(shellKb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
