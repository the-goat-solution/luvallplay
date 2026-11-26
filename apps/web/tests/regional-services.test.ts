// Track V: the regional services matrix, enforced (build plan §6.9: "anything
// that sends personal data out of the Vietnam region needs a written
// decision ... A regional services matrix lists every provider per region and
// is enforced in CI"; test plan §3.16).
//
// What this file holds the code to:
//   1. Every outside service the code uses is in the matrix. A new package
//      or host that isn't classified fails here, so a provider can't slip in.
//   2. Sydney may use everything it uses.
//   3. Hanoi: the services that block a Hanoi build are pinned. A new one
//      fails; the list only gets shorter.
//   4. The rule: no service is approved for Hanoi while receiving personal
//      data outside Vietnam without a written decision file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REGIONS } from "@luvallplay/core/host-routing";
import { LINK_ONLY_HOSTS, LOCAL_PACKAGES, REGIONAL_PLATFORM, REGIONAL_SERVICES, approvedWithoutDecision, checkRegion, serviceSwitchedOff, type RegionalService } from "@luvallplay/core/regional-services";
import { packageOf, readSources, scanSource, unclassifiedDependencies } from "../scripts/regional-services.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const usage = scanSource(readSources());
const used = [...usage.services.keys()];

/** The settings a Hanoi deployment runs with (§6.9 "The Hanoi stack"). */
const HANOI_SETTINGS = { DATABASE_DRIVER: "postgres", STORAGE_DRIVER: "s3" };

// The services that stop this code from being deployed to Hanoi today. Take
// a line out when its work is done; never add one without the owner's OK,
// because adding one means new code sends data somewhere Hanoi may not.
const HANOI_BLOCKERS = ["cloudflare-turnstile", "google-calendar", "google-identity", "google-model-hosting", "resend", "sanity", "stripe", "vercel-blob"];

test("the matrix is well-formed: every service has a status for every region", () => {
  const ids = REGIONAL_SERVICES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of REGIONAL_SERVICES) {
    assert.deepEqual(Object.keys(s.regions).sort(), [...REGIONS].sort(), s.id);
    assert.ok(s.packages.length + s.hosts.length > 0, `${s.id}: the check needs a package or a host to recognise it by`);
    assert.ok(s.name && s.purpose && s.processedIn, s.id);
    for (const r of Object.values(s.regions)) {
      if (r.status === "blocked") assert.ok(r.why && r.needs, s.id);
      if (r.status === "switched-off") assert.ok(r.by.env && (r.by.is || r.by.isNot) && r.instead, s.id);
    }
  }
  assert.equal(new Set(LOCAL_PACKAGES).size, LOCAL_PACKAGES.length);
  for (const pkg of LOCAL_PACKAGES) assert.ok(!REGIONAL_SERVICES.some((s) => s.packages.includes(pkg)), `${pkg} is both local and a service's`);
  assert.ok(REGIONAL_PLATFORM.length >= 5);
});

test("every outside service the code uses is in the matrix (nothing unclassified)", () => {
  assert.deepEqual(usage.unclassified, [], "a package or host that isn't in packages/core/src/regional-services.ts: add it to a service (with its status for each region), to LOCAL_PACKAGES or to LINK_ONLY_HOSTS");
  assert.deepEqual(unclassifiedDependencies(), [], "a dependency that isn't classified: say in packages/core/src/regional-services.ts whether it is local code or which service it talks to");
});

test("the matrix has no stale entries: every service and local package listed is really used", () => {
  assert.deepEqual(REGIONAL_SERVICES.map((s) => s.id).filter((id) => !used.includes(id)), [], "no longer used by the code: remove it from the matrix");
  const all = readSources().map((s) => s.text).join("\n");
  for (const host of LINK_ONLY_HOSTS) assert.ok(all.includes(host), `${host} is no longer written in the source: remove it from LINK_ONLY_HOSTS`);
});

test("Sydney may use everything the code uses", () => {
  assert.deepEqual(checkRegion("syd", used, {}).filter((f) => !f.ok), []);
});

test("Hanoi: exactly the pinned services block a build, and each says what it needs", () => {
  const findings = checkRegion("han", used, HANOI_SETTINGS);
  assert.deepEqual(findings.filter((f) => !f.ok).map((f) => f.service).sort(), HANOI_BLOCKERS);
  for (const f of findings.filter((f) => !f.ok)) assert.match(f.detail, /Needs: /, f.service);
  // What a Hanoi deployment keeps off by its settings.
  assert.deepEqual(findings.filter((f) => f.status === "switched-off").map((f) => [f.service, f.ok]), [["neon", true], ["google-vision", true], ["akahu", true]]);
});

test("Hanoi: a switched-off service blocks the build when its setting is in the wrong position", () => {
  const bad = (env: Record<string, string>) => checkRegion("han", used, env).filter((f) => f.status === "switched-off" && !f.ok).map((f) => f.service);
  assert.deepEqual(bad({}), ["neon"], "the default driver is Neon's");
  assert.deepEqual(bad({ DATABASE_DRIVER: "neon" }), ["neon"]);
  assert.deepEqual(bad({ DATABASE_DRIVER: "PG" }), []);
  assert.deepEqual(bad({ ...HANOI_SETTINGS, GOOGLE_VISION_ENABLED: "1" }), ["google-vision"], "photos would go to Google");
  assert.deepEqual(bad({ ...HANOI_SETTINGS, AKAHU_APP_TOKEN: "app_token_x" }), ["akahu"]);
  assert.equal(serviceSwitchedOff({ env: "X", is: [""] }, {}), true);
  assert.equal(serviceSwitchedOff({ env: "X", is: [""] }, { X: " " }), true);
  assert.equal(serviceSwitchedOff({ env: "X", isNot: ["1"] }, { X: "1" }), false);
});

test("the rule: nothing is approved for Hanoi with personal data leaving Vietnam and no written decision", () => {
  assert.deepEqual(approvedWithoutDecision(), []);
  // Every decision that is named exists and answers who, what, why, and counsel's view.
  for (const s of REGIONAL_SERVICES) {
    const r = s.regions.han;
    if (r.status !== "approved" || !r.decision) continue;
    assert.match(r.decision, /^docs\/decisions\/vietnam-data\/\d{4}-[a-z0-9-]+\.md$/, s.id);
    const file = path.join(REPO, r.decision);
    assert.ok(existsSync(file), `${s.id}: ${r.decision} doesn't exist`);
    const text = readFileSync(file, "utf8");
    for (const heading of ["## Who", "## What", "## Why", "## Counsel's view"]) assert.ok(text.includes(heading), `${r.decision} has no "${heading}"`);
  }
  assert.ok(existsSync(path.join(REPO, "docs/decisions/vietnam-data/README.md")));
});

test("the rule catches an approval without a decision, and nothing is approved for Hanoi yet", () => {
  const resend = REGIONAL_SERVICES.find((s) => s.id === "resend")!;
  const approved: RegionalService = { ...resend, regions: { ...resend.regions, han: { status: "approved" } } };
  assert.deepEqual(approvedWithoutDecision([approved]), ["resend"]);
  assert.deepEqual(approvedWithoutDecision([{ ...approved, regions: { ...approved.regions, han: { status: "approved", decision: "docs/decisions/vietnam-data/0001-resend.md" } } }]), []);
  // No personal data, or processed inside Vietnam: no decision needed.
  assert.deepEqual(approvedWithoutDecision([{ ...approved, personalData: [] }]), []);
  assert.deepEqual(approvedWithoutDecision([{ ...approved, processedIn: "Vietnam" }]), []);
  assert.deepEqual(REGIONAL_SERVICES.filter((s) => s.regions.han.status === "approved").map((s) => s.id), [], "an approval for Hanoi is the owner's and counsel's to give");
});

test("the scan recognises packages, hosts and what isn't classified", () => {
  assert.equal(packageOf("@vercel/blob/client"), "@vercel/blob");
  assert.equal(packageOf("next/headers"), "next");
  const scan = (text: string) => scanSource([{ file: "x.ts", text }]);
  assert.deepEqual([...scan('import { Resend } from "resend";').services.keys()], ["resend"]);
  assert.deepEqual([...scan('const m = await import("@vercel/blob/client");').services.keys()], ["vercel-blob"]);
  assert.deepEqual([...scan('await fetch("https://api.stripe.com/v1/charges");').services.keys()], ["stripe"]);
  assert.deepEqual([...scan('const u = `https://abc.public.blob.vercel-storage.com/${k}`;').services.keys()], ["vercel-blob"]);
  // One Google sign-in library, two services: the host in the file says which.
  assert.deepEqual([...scan('import { JWT } from "google-auth-library";\nfetch("https://vision.googleapis.com/v1/images:annotate")').services.keys()], ["google-vision"]);
  // A new provider nobody classified.
  assert.deepEqual(scan('import * as Sentry from "@sentry/nextjs";').unclassified, [{ what: "package @sentry/nextjs", file: "x.ts" }]);
  assert.deepEqual(scan('await fetch("https://api.twilio.com/2010-04-01/Messages");').unclassified, [{ what: "host api.twilio.com", file: "x.ts" }]);
  // Not outside services: our own code, Node, local libraries, links, comments, prose.
  for (const fine of ['import { z } from "zod";', 'import fs from "node:fs";', 'import crypto from "crypto";', 'import x from "@/lib/db";', 'import y from "./y";', 'import { m } from "@luvallplay/core/money";', '// see https://docs.example-provider.com/api', 'const a = <a href="https://www.facebook.com/x">Facebook</a>;', 'const label = "Sync from " + "Stripe now";', '<svg xmlns="http://www.w3.org/2000/svg" />']) {
    const r = scan(fine);
    assert.deepEqual([r.services.size, r.unclassified], [0, []], fine);
  }
});
