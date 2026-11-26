// Compare two admin snapshots (see snapshot.mjs): every file must be the
// same, byte for byte. Text differences are printed; a differing screenshot
// is named so it can be opened side by side.
//
// One difference is expected: each run seeds its own database, so pages that
// show when a seeded row was written (Inbox, the audit log) differ by the
// time of day. Those are reported as "clock only" and don't fail.
import { readFileSync, readdirSync } from "node:fs";

const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error("usage: compare.mjs <before-dir> <after-dir>");

const a = readdirSync(before).sort();
const b = readdirSync(after).sort();
const problems = [];
const clockOnly = [];
const noClock = (buf) => String(buf).replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)\b/gi, "(time)");
const page = (f) => f.replace(/(-\d+\.png|\.txt)$/, "");
for (const f of new Set([...a, ...b])) {
  if (!a.includes(f)) problems.push(`only after: ${f}`);
  else if (!b.includes(f)) problems.push(`only before: ${f}`);
  else {
    const x = readFileSync(`${before}/${f}`);
    const y = readFileSync(`${after}/${f}`);
    if (x.equals(y)) continue;
    const txt = `${page(f)}.txt`;
    if (a.includes(txt) && b.includes(txt)) {
      const [tx, ty] = [readFileSync(`${before}/${txt}`), readFileSync(`${after}/${txt}`)];
      if (!tx.equals(ty) && noClock(tx) === noClock(ty)) {
        clockOnly.push(f);
        continue;
      }
    }
    if (f.endsWith(".txt")) {
      const xs = String(x).split("\n");
      const ys = String(y).split("\n");
      const at = xs.findIndex((line, i) => line !== ys[i]);
      problems.push(`text differs: ${f}\n    before: ${(xs[at] ?? "").slice(0, 300)}\n    after:  ${(ys[at] ?? "").slice(0, 300)}`);
    } else problems.push(`screenshot differs: ${f}`);
  }
}
console.log(`${a.length} files before, ${b.length} after, ${problems.length} difference${problems.length === 1 ? "" : "s"}, ${clockOnly.length} differing only by the time of day a seeded row shows`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
