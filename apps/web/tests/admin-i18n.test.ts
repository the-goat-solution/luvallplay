// Admin i18n (build plan §6.2.4 layer 5, step A5): the admin namespace is
// complete in both languages, every menu item the registry declares has a
// translation, and the ratchet: the number of admin files still written in
// inline English can only go down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { admin, at, navKey, navLabel } from "@luvallplay/i18n/admin";
import { ADMIN_NAV_GROUPS, MODULES, PLATFORM_CONSOLE_PAGES } from "@luvallplay/modules";

const WEB = new URL("..", import.meta.url).pathname;

test("Vietnamese has exactly the English keys, none empty, with the same {placeholders}", () => {
  assert.deepEqual(Object.keys(admin.vi).sort(), Object.keys(admin.en).sort());
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [key, en] of Object.entries(admin.en)) {
    const vi = (admin.vi as Record<string, string>)[key];
    assert.ok(vi.trim(), `${key} is empty in Vietnamese`);
    assert.equal(ph(vi), ph(en), `${key} placeholders`);
  }
});

test("every menu group and page a module declares has an English and a Vietnamese label", () => {
  const missing: string[] = [];
  for (const g of ADMIN_NAV_GROUPS.filter(Boolean)) if (!(navKey(g, true) in admin.en)) missing.push(`group ${g}`);
  for (const m of MODULES) for (const n of m.admin?.nav ?? []) if (!(navKey(n.label) in admin.en)) missing.push(`${m.id}: ${n.label}`);
  for (const n of PLATFORM_CONSOLE_PAGES) if (!(navKey(n.label) in admin.en)) missing.push(`platform: ${n.label}`);
  assert.deepEqual(missing, [], "add nav_… keys to packages/i18n/src/admin.ts");
});

test("labels and messages follow the language, and fall back to what was written", () => {
  assert.equal(navLabel("en", "Play days"), "Play days");
  assert.equal(navLabel("vi", "Play days"), "Ngày chơi");
  assert.equal(navLabel("vi", "Something new"), "Something new");
  assert.equal(navLabel("vi", "Money", true), "Tiền");
  assert.equal(at("vi", "shell_sign_in"), "Đăng nhập");
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

// Ratchet: admin screens (.tsx) that don't read the admin namespace yet.
// Lower this number when you translate a screen; it must never go up.
const UNTRANSLATED_MAX = 23;

test("ratchet: admin screens still written in inline English only go down", () => {
  const left = [join(WEB, "app/admin"), join(WEB, "components/admin")]
    .flatMap((d) => sourceFiles(d))
    .filter((f) => !/@luvallplay\/i18n\/admin|lib\/admin-lang/.test(readFileSync(f, "utf8")))
    // layouts, loading shells and files with no words of their own
    .filter((f) => /[>"'`]\s*[A-Z][a-z]+ [a-z]+/.test(readFileSync(f, "utf8").replace(/import .*|\/\/.*|\/\*[\s\S]*?\*\//g, "")))
    .map((f) => relative(WEB, f));
  assert.ok(left.length <= UNTRANSLATED_MAX, `${left.length} untranslated (max ${UNTRANSLATED_MAX}):\n${left.join("\n")}`);
});

test("the Play days toasts follow the language", async () => {
  const { playDaysFor } = await import("../components/admin/flash-rules.ts");
  const en = playDaysFor(16, "en");
  const vi = playDaysFor(16, "vi");
  assert.equal(en.courtsUpdated!("2")?.text, "Courts saved: 2 courts.");
  assert.equal(vi.courtsUpdated!("2")?.text, "Đã lưu số sân: 2 sân.");
  assert.match(vi.miniGame!("on")!.text, /16 người/);
  assert.match(vi.cashAdded!("cash")!.text, /^Đã thêm Người chơi/);
});

test("every weekday the club can use has a name in both languages", async () => {
  const { WEEKDAYS } = await import("../lib/constants.ts");
  for (const d of WEEKDAYS) {
    assert.ok(`weekday_${d}` in admin.en, `weekday_${d}`);
    assert.ok(at("vi", `weekday_${d}` as keyof typeof admin.en).trim());
  }
});

test("every Today attention item a module declares has an English and a Vietnamese sentence and action", () => {
  const missing: string[] = [];
  for (const m of MODULES) {
    for (const a of m.admin?.attention ?? []) {
      for (const part of ["one", "many", "action"]) {
        const key = `att_${a.key}_${part}`;
        if (!(key in admin.en)) missing.push(key);
      }
    }
  }
  assert.deepEqual(missing, [], "add att_… keys to packages/i18n/src/admin.ts");
});

test("every audit code the admin can log has a Vietnamese description", async () => {
  const { auditLabelIn, auditDetailsIn, auditOutcomeNoteIn, roleName } = await import("../lib/admin-audit-text.ts");
  const codes = ["admin.granted", "admin.role_changed", "admin.removed", "admin.invited", "admin.invite_accepted", "admin.invite_revoked", "admin.break_glass_login", "admin.handoff_created", "admin.handoff_used", "platform.granted", "platform.removed", "module.switch", "module.lock", "membership.cancel", "membership.free_month", "payment.retry", "stripe.sync", "export.finance", "export.shop", "export.jersey", "finance.receipt_view", "shop.refund"];
  for (const code of codes) assert.notEqual(auditLabelIn("vi", code), auditLabelIn("en", code), `${code} has no Vietnamese description`);
  assert.equal(auditLabelIn("vi", "POST /admin/shop"), "Đã thay đổi ở Cửa hàng");
  assert.equal(auditLabelIn("en", "POST /admin/shop"), "Made a change on Shop");
  assert.equal(auditDetailsIn("vi", { action: "admin.role_changed", meta: { from: "admin", to: "owner" } }), "vai trò quản trị viên → chủ sở hữu");
  assert.equal(auditOutcomeNoteIn("vi", { outcome: "refused", reason: "x" }), "chưa thực hiện: x");
  assert.equal(roleName("vi", "coach"), "huấn luyện viên");
});

test("finance labels follow the language, and every category, method and period has a name", async () => {
  const { FINANCE_CATEGORIES, FINANCE_METHODS, FINANCE_PRESETS } = await import("../lib/finance.ts");
  const t = await import("../lib/finance-text.ts");
  for (const c of FINANCE_CATEGORIES) assert.notEqual(t.categoryLabelIn("vi", c.value), c.label, c.value);
  for (const m of FINANCE_METHODS) assert.notEqual(t.methodLabelIn("vi", m.value), m.label === "Other" ? "" : m.label, m.value);
  for (const p of FINANCE_PRESETS) assert.ok(t.presetLabelIn("vi", p.value).trim(), p.value);
  for (const c of FINANCE_CATEGORIES) assert.equal(t.categoryLabelIn("en", c.value), c.label);
  assert.equal(t.formatDateKeyIn("en", "2026-10-09"), "9 Oct 2026");
  assert.equal(t.formatDateKeyIn("vi", "2026-10-09"), "9 thg 10 2026");
  assert.equal(t.monthLabelIn("vi", "2026-11", { year: true }), "thg 11 2026");
  assert.equal(t.formatRangeIn("vi", null, null), "Mọi thời gian");
});
