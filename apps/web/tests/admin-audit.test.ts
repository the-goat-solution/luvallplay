// Per-action audit rows (audit H7): every /api/admin call by an admin leaves
// a named row with its outcome, exports (GET) included, and only
// allow-listed fields are kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { auditedRoute, type ActionRecord } from "../lib/admin-audit.ts";
import type { AdminContext } from "../lib/admin-access.ts";
import { auditLabel, auditOutcomeNote } from "../lib/admin-audit-labels.ts";

const OWNER = { kind: "player", player: { id: 7, email: "o@e2e.test", firstName: "O", lastName: "O" }, access: { role: "owner", platformAdmin: false }, signedInAt: new Date(), stepUpFresh: true } as AdminContext;

function harness(ctx: AdminContext | null = OWNER) {
  const rows: ActionRecord[] = [];
  const deps = { context: async () => ctx, record: async (_ctx: AdminContext | null, r: ActionRecord) => void rows.push(r) };
  return { rows, deps };
}

test("an export (GET) is logged, with its filter and the outcome", async () => {
  const { rows, deps } = harness();
  const GET = auditedRoute("export.shop", async () => new Response("xlsx"), { deps });
  await GET(new Request("http://club.test/api/admin/shop/export?orders=all&q=mia"));
  assert.deepEqual(rows, [{ action: "export.shop", target: "/api/admin/shop/export", outcome: "ok", meta: { status: 200, fields: { orders: "all" } } }]);
});

test("a POST keeps the id it acted on; the handler still reads the body", async () => {
  const { rows, deps } = harness();
  const POST = auditedRoute(
    "membership.cancel",
    async (request) => {
      const body = (await request.json()) as { membershipId: number };
      return Response.json({ ok: true, id: body.membershipId });
    },
    { deps },
  );
  const res = await POST(new Request("http://club.test/api/admin/cancel-membership", { method: "POST", body: JSON.stringify({ membershipId: 42, medicalNotes: "asthma", reason: "moved" }) }));
  assert.deepEqual(await res.json(), { ok: true, id: 42 });
  assert.deepEqual(rows, [{ action: "membership.cancel", target: "42", outcome: "ok", meta: { status: 200, fields: { membershipId: "42" } } }]);
});

test("outcome follows the answer: refused for 4xx, failed for 5xx and for a thrown error", async () => {
  const { rows, deps } = harness();
  await auditedRoute("payment.retry", async () => Response.json({ error: "Membership not found" }, { status: 404 }), { deps })(new Request("http://club.test/x", { method: "POST" }));
  await auditedRoute("stripe.sync", async () => Response.json({ error: "Stripe is down" }, { status: 502 }), { deps })(new Request("http://club.test/x", { method: "POST" }));
  await assert.rejects(auditedRoute("stripe.sync", async () => Promise.reject(new Error("boom")), { deps })(new Request("http://club.test/x", { method: "POST" })), /boom/);
  assert.deepEqual(rows.map((r) => [r.action, r.outcome, r.meta?.status]), [["payment.retry", "refused", 404], ["stripe.sync", "failed", 502], ["stripe.sync", "failed", undefined]]);
});

test("someone who isn't a signed-in admin writes no row (the handler refuses them)", async () => {
  const { rows, deps } = harness(null);
  const res = await auditedRoute("export.finance", async () => Response.json({ error: "Unauthorized" }, { status: 401 }), { deps })(new Request("http://club.test/x"));
  assert.equal(res.status, 401);
  assert.deepEqual(rows, []);
});

test("every /api/admin route writes its own audit row (the handoff has its own)", () => {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  };
  const root = new URL("../app/api/admin", import.meta.url).pathname;
  assert.ok(existsSync(root));
  walk(root);
  assert.ok(routes.length >= 9);
  const codes: string[] = [];
  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    if (file.endsWith("/handoff/route.ts")) {
      assert.match(src, /createHandoff|audit\(/, "the handoff writes admin.handoff_created");
      continue;
    }
    const handlers = [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b([^\n]*)/g)];
    assert.ok(handlers.length > 0, file);
    for (const h of handlers) {
      const code = /= auditedRoute\("([a-z_.]+)"/.exec(h[2])?.[1];
      assert.ok(code, `${file}: ${h[1]} must be wrapped in auditedRoute("<area>.<what>", …)`);
      codes.push(code);
    }
  }
  assert.equal(new Set(codes).size, codes.length, "one code per route");
  for (const code of codes) assert.notEqual(auditLabel(code), code, `${code} needs a label in lib/admin-audit-labels.ts`);
});

test("the audit log says when an action wasn't done", () => {
  assert.equal(auditOutcomeNote({ outcome: "ok" }), "");
  assert.equal(auditOutcomeNote({}), "", "older rows have no outcome");
  assert.equal(auditOutcomeNote({ outcome: "refused", reason: "Bank matching needs Finance & reports turned on first." }), "not done: Bank matching needs Finance & reports turned on first.");
  assert.equal(auditOutcomeNote({ outcome: "failed" }), "failed");
});

// ---------------------------------------------------------------------------
// Per-action step-up (audit H8)
// ---------------------------------------------------------------------------

test("step-up: a sensitive route needs a code entered in the last five minutes", async () => {
  const { ACTION_STEP_UP_MAX_AGE_MS, STEP_UP_MAX_AGE_MS, isActionStepUpFresh, isStepUpFresh } = await import("@luvallplay/auth");
  assert.equal(ACTION_STEP_UP_MAX_AGE_MS, 5 * 60 * 1000);
  const now = Date.now();
  assert.equal(isActionStepUpFresh(new Date(now - 4 * 60_000), now), true);
  assert.equal(isActionStepUpFresh(new Date(now - 6 * 60_000), now), false);
  assert.equal(isActionStepUpFresh(new Date(now + 3_600_000), now), false, "a session from the future is not trusted");
  assert.equal(isActionStepUpFresh(null, now), false);
  // Opening admin is unchanged: 12 hours.
  assert.equal(isStepUpFresh(new Date(now - 6 * 60_000), now), true);
  assert.equal(isStepUpFresh(new Date(now - STEP_UP_MAX_AGE_MS - 1000), now), false);

  const stale = { ...OWNER, signedInAt: new Date(now - 6 * 60_000) } as AdminContext;
  let ran = 0;
  const handler = async () => {
    ran++;
    return new Response("done");
  };

  // Fresh: runs.
  const fresh = harness({ ...OWNER, signedInAt: new Date(now - 60_000) } as AdminContext);
  assert.equal((await auditedRoute("membership.cancel", handler, { stepUp: true, deps: fresh.deps })(new Request("http://club.test/api/admin/cancel-membership", { method: "POST" }))).status, 200);
  assert.equal(ran, 1);

  // Stale, from a button (fetch): 401 step_up, the handler never runs, and the refusal is on record.
  const a = harness(stale);
  const res = await auditedRoute("membership.cancel", handler, { stepUp: true, deps: a.deps })(new Request("http://club.test/api/admin/cancel-membership", { method: "POST", body: JSON.stringify({ membershipId: 9 }) }));
  assert.deepEqual([res.status, await res.json()], [401, { error: "step_up", scope: "action" }]);
  assert.equal(ran, 1);
  assert.deepEqual(a.rows, [{ action: "membership.cancel", target: "9", outcome: "refused", reason: "asked for a fresh sign-in code", meta: { status: 401, fields: { membershipId: "9" } } }]);

  // Stale, an export link clicked on an admin page: to the code screen, then back to that page.
  const b = harness(stale);
  const nav = await auditedRoute("export.shop", handler, { stepUp: true, deps: b.deps })(
    new Request("http://club.test/api/admin/shop/export?orders=all", { headers: { accept: "text/html,application/xhtml+xml", referer: "http://club.test/admin/shop?orders=all" } }),
  );
  assert.equal(nav.status, 303);
  assert.equal(nav.headers.get("location"), "http://club.test/login?stepup=action&next=%2Fadmin%2Fshop%3Forders%3Dall");
  // A referer from somewhere else is never followed.
  const c = harness(stale);
  const away = await auditedRoute("export.shop", handler, { stepUp: true, deps: c.deps })(
    new Request("http://club.test/api/admin/shop/export", { headers: { accept: "text/html", referer: "http://evil.test/admin/shop" } }),
  );
  assert.equal(away.headers.get("location"), "http://club.test/login?stepup=action&next=%2Fadmin");
  assert.equal(ran, 1, "nothing ran without a fresh code");

  // Without stepUp (a receipt, a free month) an older sign-in is enough, as before.
  const d = harness(stale);
  assert.equal((await auditedRoute("finance.receipt_view", handler, { deps: d.deps })(new Request("http://club.test/x"))).status, 200);
});

test("step-up: every sensitive admin action asks for the fresh code", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  // Routes: cancellations and every export.
  for (const route of ["cancel-membership", "finance/export", "shop/export", "jersey/export"]) {
    assert.match(read(`../app/api/admin/${route}/route.ts`), /\}, \{ stepUp: true \}\);/, route);
  }
  // Server actions: module switches and locks, admins, platform staff, refunds.
  const actions: [string, string[]][] = [
    ["../app/admin/(console)/settings/modules/page.tsx", ["module.switch", "module.lock"]],
    ["../app/admin/(console)/people/admins/page.tsx", ["admin.granted", "admin.role_changed", "admin.removed"]],
    ["../app/admin/(console)/platform/admins/page.tsx", ["platform.granted", "platform.removed"]],
    ["../app/admin/(console)/shop/page.tsx", ["shop.refund"]],
  ];
  for (const [file, codes] of actions) {
    const src = read(file);
    for (const code of codes) assert.ok(src.includes(`requireFreshAdminActor(PATH, "${code}"`) || src.includes(`requireFreshAdminActor("/admin/shop", "${code}"`), `${file}: ${code}`);
  }
});
