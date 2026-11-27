// Scheduled jobs behind one interface (Phase 3 step 6; test plan §3.16
// "Storage and cron adapters pass the same contract tests").

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MODULES, blockedByModule, routeOwner } from "@luvallplay/modules";
import { CRON_JOBS, cronAuthorized } from "../lib/cron.ts";
import { cronManifests } from "../scripts/cron/k8s.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("the job list, vercel.json and the route files agree", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  assert.deepEqual([...vercel.crons].sort(byPath), CRON_JOBS.map(({ path: p, schedule }) => ({ path: p, schedule })).sort(byPath));
  const routes = fs.readdirSync(path.join(root, "app/api/cron")).filter((d) => fs.existsSync(path.join(root, "app/api/cron", d, "route.ts")));
  assert.deepEqual(routes.sort(), CRON_JOBS.map((j) => j.path.replace("/api/cron/", "")).sort());
  assert.equal(new Set(CRON_JOBS.map((j) => j.id)).size, CRON_JOBS.length);
  for (const job of CRON_JOBS) {
    assert.match(job.schedule, /^(\S+\s+){4}\S+$/, job.id);
    assert.ok(routeOwner(job.path), `${job.path} has an owner in the module route table`);
    // Every job checks the scheduler's secret the same way.
    const source = fs.readFileSync(path.join(root, "app", job.path, "route.ts"), "utf8");
    assert.match(source, /cronAuthorized\(request\)/, job.id);
    assert.doesNotMatch(source, /process\.env\.CRON_SECRET/, `${job.id} reads the secret itself`);
  }
});

test("only the scheduler's secret is authorised, and nothing is when no secret is set in production", () => {
  const env = { secret: process.env.CRON_SECRET, node: process.env.NODE_ENV };
  const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  const call = (auth?: string) => cronAuthorized(new Request("https://club.example/api/cron/send-roster", auth ? { headers: { authorization: auth } } : undefined));
  try {
    set("CRON_SECRET", "s3cret");
    assert.equal(call("Bearer s3cret"), true);
    assert.equal(call("Bearer wrong"), false);
    assert.equal(call("s3cret"), false);
    assert.equal(call(), false);
    set("CRON_SECRET", undefined);
    set("NODE_ENV", "production");
    assert.equal(call(), false);
    assert.equal(call("Bearer undefined"), false);
    assert.equal(call("Bearer "), false);
    set("NODE_ENV", "development");
    assert.equal(call(), true);
  } finally {
    set("CRON_SECRET", env.secret);
    set("NODE_ENV", env.node);
  }
});

test("the Kubernetes manifests call the same routes with the same header, and never print the secret", () => {
  const yaml = cronManifests({ url: "https://hanoi.example", secretName: "app-secrets", namespace: "luvallplay" });
  const docs = yaml.split("\n---\n");
  assert.equal(docs.length, CRON_JOBS.length);
  for (const [i, job] of CRON_JOBS.entries()) {
    assert.match(docs[i], new RegExp(`name: ${job.id}\\n`));
    assert.ok(docs[i].includes(`schedule: "${job.schedule}"`));
    assert.ok(docs[i].includes(`https://hanoi.example${job.path}`));
    assert.ok(docs[i].includes("Authorization: Bearer $CRON_SECRET"));
    assert.ok(docs[i].includes("name: app-secrets"));
  }
  assert.throws(() => cronManifests({ url: "http://hanoi.example", secretName: "app-secrets" }), /https/);
  assert.throws(() => cronManifests({ url: "https://hanoi.example", secretName: "Bad Name" }), /Kubernetes name/);
});

test("a module switched off stops its own jobs and no other module's (audit H2)", () => {
  const all = new Set(MODULES.map((m) => m.id));
  const without = (id: string) => new Set([...all].filter((m) => m !== id));
  const stopped = (off: string) => CRON_JOBS.filter((j) => blockedByModule(j.path, without(off))).map((j) => j.id).sort();
  // Memberships off: only the membership reminders stop. Webhook retries,
  // shop upkeep and roster attendance used to ride on that job and stopped with it.
  assert.deepEqual(stopped("memberships"), ["membership-reminders"]);
  assert.deepEqual(stopped("integrations"), ["webhook-retries"]);
  assert.deepEqual(stopped("shop"), ["shop-upkeep"]);
  // The core's jobs never stop.
  for (const id of ["headcount-alerts", "send-roster", "roster-attendance"]) assert.equal(routeOwner(`/api/cron/${id}`), "core", id);
  // And the reminders job no longer does the others' work.
  const reminders = fs.readFileSync(path.join(root, "app/api/cron/membership-reminders/route.ts"), "utf8");
  assert.doesNotMatch(reminders, /retryWebhookDeliveries|runShopDailyUpkeep|recordRosterAttendance/);
});
