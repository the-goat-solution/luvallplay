// The audit log's wording in the admin's language. The English source and the
// fallback for a code with no translation yet is lib/admin-audit-labels.ts;
// nothing here changes what is logged, only how a row is described.
import { admin, at, navLabel, type AdminKey } from "@luvallplay/i18n/admin";
import type { Lang } from "@luvallplay/i18n";
import { activeHref } from "@/components/admin/nav-config";
import { NAV_GROUPS } from "@/components/admin/nav-registry";
import { auditLabel } from "./admin-audit-labels.ts";

const PAGE_LABEL = new Map(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label] as const)));

/** "admin.role_changed" -> the key aud_admin_role_changed. */
const keyFor = (action: string) => `aud_${action.replace(/[^a-z0-9]+/gi, "_")}`;

export function auditLabelIn(lang: Lang, action: string): string {
  const key = keyFor(action);
  if (key in at_keys()) return at(lang, key as AdminKey);
  const m = /^(POST|PUT|PATCH|DELETE) (\/admin[^\s?]*)/.exec(action);
  if (m) {
    const href = activeHref(m[2], NAV_GROUPS);
    const page = href ? PAGE_LABEL.get(href) : null;
    if (page) return at(lang, "aud_change_on", { page: navLabel(lang, page) });
    if (m[2].startsWith("/api/admin/")) return at(lang, "aud_admin_action", { name: m[2].replace("/api/admin/", "").replace(/-/g, " ") });
  }
  return auditLabel(action);
}

function at_keys(): Record<string, string> {
  return admin.en as Record<string, string>;
}

export function auditOutcomeNoteIn(lang: Lang, meta: Record<string, unknown> | null | undefined): string {
  const outcome = String(meta?.outcome ?? "");
  const word = outcome === "refused" ? at(lang, "aud_not_done") : outcome === "failed" ? at(lang, "aud_failed") : "";
  if (!word) return "";
  return typeof meta?.reason === "string" && meta.reason ? `${word}: ${meta.reason}` : word;
}

type Row = { action: string; meta?: Record<string, unknown> | null };

export function auditDetailsIn(lang: Lang, row: Row): string {
  const meta = row.meta ?? {};
  if (row.action === "admin.role_changed") return at(lang, "aud_role_change", { from: roleName(lang, meta.from), to: roleName(lang, meta.to) });
  if (row.action === "admin.granted" || row.action === "admin.invited") {
    return at(lang, "aud_granted_as", {
      what: at(lang, row.action === "admin.granted" ? "aud_what_granted" : "aud_what_invited"),
      role: roleName(lang, meta.to ?? meta.role),
    });
  }
  if (row.action === "module.switch") return meta.changed === false ? at(lang, "aud_no_change") : at(lang, meta.on ? "aud_turned_on" : "aud_turned_off");
  if (row.action === "module.lock") {
    return meta.changed === false ? at(lang, "aud_no_change") : meta.lock === "unlocked" ? at(lang, "aud_unlocked") : at(lang, "aud_locked", { lock: String(meta.lock) });
  }
  if (meta.fields && typeof meta.fields === "object") {
    return Object.entries(meta.fields as Record<string, string>)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }
  return "";
}

/** A role name for display ("owner" -> "chủ sở hữu"); anything else as written. */
export function roleName(lang: Lang, role: unknown): string {
  const key = `role_${String(role)}`;
  return key in at_keys() ? at(lang, key as AdminKey) : String(role);
}
