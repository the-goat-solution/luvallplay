// Data guard command line. See docs/testing/data-safety.md for the full protocol.
//
//   npm run data-guard -- snapshot --out .data-guard/before.json [--label "before 0001"]
//   npm run data-guard -- check .data-guard/before.json
//   npm run data-guard -- diff .data-guard/before.json .data-guard/after.json --expect scripts/data-guard/expectations/0001-x.json
//   npm run data-guard -- rehearse --expect <file> --run "<migration command>"
//
// The database comes from DATA_GUARD_URL (preferred) or POSTGRES_URL.
// `rehearse` only ever runs against DATA_GUARD_URL, and refuses when that is
// the same database as POSTGRES_URL or a host listed in
// DATA_GUARD_PRODUCTION_HOSTS: rehearsals belong on a copy (a Neon branch).

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ExpectationsSchema,
  NO_CHANGES,
  SNAPSHOT_VERSION,
  checkSnapshot,
  diffSnapshots,
  formatFindings,
  hasErrors,
  type Expectations,
  type Finding,
  type Snapshot,
} from "./core.ts";
import { describeUrl, takeSnapshot } from "./pg.ts";

/** Reports are shared (pull requests): emails in a --run command are masked, like grant-role's output. */
export function maskEmails(text: string): string {
  return text.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const flag = (args: string[], name: string) => args.includes(`--${name}`);
const VALUE_FLAGS = new Set(["--out", "--label", "--expect", "--report", "--run", "--out-dir"]);
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++;
    else if (!args[i].startsWith("--")) out.push(args[i]);
  }
  return out;
}

function readSnapshot(file: string): Snapshot {
  const s = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  if (s.version !== SNAPSHOT_VERSION) throw new Error(`${file}: snapshot version ${s.version}, expected ${SNAPSHOT_VERSION}`);
  return s;
}

export function readExpectations(file: string | undefined): Expectations {
  if (!file) return NO_CHANGES;
  const parsed = ExpectationsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is not a valid expectations file:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return parsed.data;
}

function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function report(title: string, findings: Finding[], strict: boolean): number {
  console.log(`\n${title}\n${formatFindings(findings)}\n`);
  const failed = hasErrors(findings) || (strict && findings.some((f) => f.level === "warning"));
  console.log(failed ? "RESULT: ✖ FAILED — do not deploy this change." : "RESULT: ✔ passed.");
  return failed ? 1 : 0;
}

function markdownReport(title: string, findings: Finding[], meta: Record<string, string>): string {
  const rows = findings.map((f) => `| ${f.level} | ${f.code} | ${f.message.replace(/\|/g, "\\|")} | ${f.count ?? ""} |`);
  return [
    `# ${title}`,
    "",
    ...Object.entries(meta).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    `**Result:** ${hasErrors(findings) ? "✖ FAILED" : "✔ passed"}`,
    "",
    "| Level | Check | Detail | Count |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function databaseUrl(): string {
  const url = process.env.DATA_GUARD_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("Set DATA_GUARD_URL (or POSTGRES_URL) to the database to read.");
  return url;
}

function assertNotProduction(url: string) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const prodHosts = (process.env.DATA_GUARD_PRODUCTION_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (process.env.POSTGRES_URL && process.env.POSTGRES_URL === url) throw new Error("Refusing to rehearse: DATA_GUARD_URL is the same database as POSTGRES_URL. Rehearse on a Neon branch.");
  if (prodHosts.includes(host)) throw new Error(`Refusing to rehearse on ${host}: it is listed in DATA_GUARD_PRODUCTION_HOSTS.`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "snapshot": {
      const url = databaseUrl();
      const out = arg(args, "out") ?? join(".data-guard", `snapshot-${Date.now()}.json`);
      console.log(`Reading ${describeUrl(url)} (read-only)…`);
      const snap = await takeSnapshot(url, { label: arg(args, "label") ?? "" });
      writeJson(out, snap);
      console.log(`Saved ${out}: ${Object.keys(snap.tables).length} tables, ${snap.people.length} accounts.`);
      return report("Access checks", checkSnapshot(snap), flag(args, "strict"));
    }
    case "check": {
      const [file] = positional(args);
      if (!file) throw new Error("Usage: check <snapshot.json>");
      return report(`Access checks for ${file}`, checkSnapshot(readSnapshot(file)), flag(args, "strict"));
    }
    case "diff": {
      const [beforeFile, afterFile] = positional(args);
      if (!beforeFile || !afterFile) throw new Error("Usage: diff <before.json> <after.json> [--expect file] [--report file.md] [--json] [--strict]");
      const x = readExpectations(arg(args, "expect"));
      const findings = diffSnapshots(readSnapshot(beforeFile), readSnapshot(afterFile), x);
      if (flag(args, "json")) console.log(JSON.stringify(findings, null, 2));
      const md = arg(args, "report");
      if (md) writeFileSync(md, markdownReport(`Data guard: ${x.change}`, findings, { Before: beforeFile, After: afterFile, Expectations: arg(args, "expect") ?? "none (nothing may change)" }));
      return report(`Data guard: ${x.change}`, findings, flag(args, "strict"));
    }
    case "rehearse": {
      const url = process.env.DATA_GUARD_URL;
      if (!url) throw new Error("rehearse needs DATA_GUARD_URL pointing at a copy of production (a Neon branch).");
      assertNotProduction(url);
      const run = arg(args, "run");
      if (!run) throw new Error('Usage: rehearse --expect <file> --run "<migration command>"');
      const x = readExpectations(arg(args, "expect"));
      const dir = arg(args, "out-dir") ?? join(".data-guard", `rehearsal-${x.change}-${Date.now()}`);
      console.log(`Rehearsing "${x.change}" on ${describeUrl(url)}`);
      const before = await takeSnapshot(url, { label: `before ${x.change}` });
      writeJson(join(dir, "before.json"), before);
      const pre = checkSnapshot(before);
      if (hasErrors(pre)) {
        report("Access checks BEFORE the change (fix these first)", pre, false);
        return 1;
      }
      const started = Date.now();
      const res = spawnSync(run, { shell: true, stdio: "inherit", env: { ...process.env, POSTGRES_URL: url, DATABASE_URL_VAR: "POSTGRES_URL" } });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (res.status !== 0) {
        console.error(`\nThe migration command failed (exit ${res.status}) after ${seconds}s. Inspect the branch, then reset it before retrying.`);
        return 1;
      }
      const after = await takeSnapshot(url, { label: `after ${x.change}` });
      writeJson(join(dir, "after.json"), after);
      const findings = diffSnapshots(before, after, x);
      writeFileSync(
        join(dir, "report.md"),
        markdownReport(`Rehearsal: ${x.change}`, findings, { Database: describeUrl(url), Command: maskEmails(run), Duration: `${seconds}s`, Expectations: arg(args, "expect") ?? "none" }),
      );
      console.log(`\nMigration took ${seconds}s. Report: ${join(dir, "report.md")}`);
      return report(`Rehearsal: ${x.change}`, findings, flag(args, "strict"));
    }
    default:
      console.log("Usage: data-guard <snapshot|check|diff|rehearse> …  (see scripts/data-guard/cli.ts)");
      return cmd ? 1 : 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`data-guard: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
