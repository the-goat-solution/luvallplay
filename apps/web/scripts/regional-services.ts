// The regional services check (build plan §6.9; test plan §3.16: "a build
// for a region fails if it imports a provider that isn't approved for that
// region").
//
// It reads the code of the server (apps/web) and the players' app
// (apps/app), finds every outside service they use (by the packages they
// import and the hosts written in the source), and holds that against the
// matrix in @luvallplay/core/regional-services.
//
//   node scripts/regional-services.ts --region han            report
//   node scripts/regional-services.ts --region han --strict   exit 1 on any
//       service the region may not use. A region's build pipeline runs this
//       with the region's own settings in the environment.
//
// CI runs the same functions (tests/regional-services.test.ts): everything
// must be classified, Sydney must be clean, and Hanoi's list of blockers is
// pinned so it can only get shorter.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { isRegion } from "@luvallplay/core/host-routing";
import { LINK_ONLY_HOSTS, LOCAL_PACKAGES, REGIONAL_SERVICES, checkRegion, type RegionalService } from "@luvallplay/core/regional-services";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** What a region's deployment is built from. The public website (apps/site) is not part of a club region. */
export const SCANNED = ["apps/web/app", "apps/web/lib", "apps/web/components", "apps/web/context", "apps/web/hooks", "apps/web/proxy.ts", "apps/web/instrumentation.ts", "apps/web/next.config.ts", "apps/app/src", "apps/app/index.html"];
export const MANIFESTS = ["apps/web/package.json", "apps/app/package.json"];

function files(rel: string): string[] {
  const abs = path.join(REPO, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(child);
    return /\.(ts|tsx|mjs|js|html)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [child] : [];
  });
}

/** "@scope/name/sub" → "@scope/name"; "name/sub" → "name". */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const isOurs = (pkg: string) => pkg.startsWith("@luvallplay/") || pkg.startsWith("node:") || builtinModules.includes(pkg) || pkg === "server-only" || pkg === "client-only";
/** Shaped like an npm package name with a letter in it, so a sentence or a date in quotes after the word "from" isn't taken for an import. */
const PACKAGE_NAME = /^(?=.*[a-z])(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*(\/[A-Za-z0-9._~/-]+)?$/;
const isLocal = (pkg: string) => LOCAL_PACKAGES.includes(pkg);
const hostMatches = (host: string, known: string) => host === known || host.endsWith(`.${known}`);

export type Usage = {
  /** Service id → the files that use it. */
  services: Map<string, string[]>;
  /** Packages and hosts that aren't in the matrix, the local list or the link list. */
  unclassified: { what: string; file: string }[];
};

export function scanSource(sources: { file: string; text: string }[], services: readonly RegionalService[] = REGIONAL_SERVICES): Usage {
  const found = new Map<string, Set<string>>();
  const unclassified: Usage["unclassified"] = [];
  const mark = (id: string, file: string) => found.set(id, (found.get(id) ?? new Set()).add(file));

  for (const { file, text } of sources) {
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("/") || !PACKAGE_NAME.test(spec)) continue;
      const pkg = packageOf(spec);
      if (isOurs(pkg) || isLocal(pkg)) continue;
      const owners = services.filter((s) => s.packages.includes(pkg));
      if (owners.length === 0) unclassified.push({ what: `package ${pkg}`, file });
      // A package shared by two services (one Google sign-in library) counts for the service whose host the file names; with no host named, for each.
      const named = owners.filter((s) => s.hosts.some((h) => text.includes(h)));
      for (const s of named.length ? named : owners) mark(s.id, file);
    }
    for (const line of text.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(/https?:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g)) {
        const host = m[1].toLowerCase();
        if (host === "www.w3.org" || host === "localhost" || /^\d+(\.\d+){3}$/.test(host) || /\.(test|example|invalid)$/.test(host) || /^example\.(com|org)$/.test(host)) continue;
        if (LINK_ONLY_HOSTS.some((h) => hostMatches(host, h))) continue;
        const owners = services.filter((s) => s.hosts.some((h) => hostMatches(host, h)));
        if (owners.length === 0) unclassified.push({ what: `host ${host}`, file });
        for (const s of owners) mark(s.id, file);
      }
    }
  }
  return { services: new Map([...found].map(([id, set]) => [id, [...set].sort()])), unclassified };
}

/** The code a region's deployment is built from. */
export function readSources(): { file: string; text: string }[] {
  return SCANNED.flatMap(files).map((file) => ({ file, text: readFileSync(path.join(REPO, file), "utf8") }));
}

/** Dependencies declared by the apps that aren't classified as local or as a service's. */
export function unclassifiedDependencies(services: readonly RegionalService[] = REGIONAL_SERVICES): string[] {
  const out: string[] = [];
  for (const manifest of MANIFESTS) {
    const json = JSON.parse(readFileSync(path.join(REPO, manifest), "utf8")) as { dependencies?: Record<string, string> };
    for (const pkg of Object.keys(json.dependencies ?? {})) {
      if (isOurs(pkg) || isLocal(pkg) || services.some((s) => s.packages.includes(pkg))) continue;
      out.push(`${manifest}: ${pkg}`);
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const region = args[args.indexOf("--region") + 1];
  const strict = args.includes("--strict");
  if (!args.includes("--region") || !isRegion(region)) {
    console.error("Usage: node scripts/regional-services.ts --region <syd|han> [--strict]");
    process.exit(2);
  }
  const usage = scanSource(readSources());
  const unknown = [...usage.unclassified.map((u) => `${u.what} (${u.file})`), ...unclassifiedDependencies()];
  const findings = checkRegion(region, [...usage.services.keys()], process.env);
  console.log(`Outside services used by the code, for region "${region}":`);
  for (const f of findings) console.log(`  ${f.ok ? "ok     " : "BLOCKED"}  ${f.service.padEnd(22)} ${f.status.padEnd(13)} ${f.detail}`);
  if (unknown.length) console.log(`\nNot classified in the matrix (add each to packages/core/src/regional-services.ts):\n  ${unknown.join("\n  ")}`);
  const bad = findings.filter((f) => !f.ok).length + unknown.length;
  console.log(bad ? `\n${bad} problem(s): this code can't be deployed to "${region}" as it is.` : `\nNothing blocks "${region}".`);
  if (strict && bad) process.exit(1);
}
