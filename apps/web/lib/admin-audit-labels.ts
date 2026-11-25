import { NAV_GROUPS, activeHref } from "@/components/admin/nav-config";

// Readable wording for the audit log's "What" column. Unknown codes fall
// back to the raw code, so nothing is ever hidden.
const LABELS: Record<string, string> = {
  "admin.granted": "Gave admin access",
  "admin.role_changed": "Changed an admin's role",
  "admin.removed": "Removed admin access",
  "admin.invited": "Invited an admin",
  "admin.invite_accepted": "Admin invite accepted",
  "admin.invite_revoked": "Cancelled an admin invite",
  "admin.break_glass_login": "Signed in with the admin password",
  "admin.handoff_created": "Opened admin from the app",
  "admin.handoff_used": "Opened admin from the app",
  "platform.granted": "Added platform staff",
  "platform.removed": "Removed platform staff",
  // Per-action rows with an outcome (lib/admin-audit.ts).
  "module.switch": "Switched a module",
  "module.lock": "Locked or unlocked a module",
  "membership.cancel": "Cancelled a membership",
  "membership.free_month": "Gave a free month",
  "payment.retry": "Retried a member's payment",
  "stripe.sync": "Synced memberships with Stripe",
  "export.finance": "Downloaded the finance export",
  "export.shop": "Downloaded the shop export",
  "export.jersey": "Downloaded the jersey export",
  "finance.receipt_view": "Opened a receipt",
};

const OUTCOME: Record<string, string> = { refused: "not done", failed: "failed" };

/** "not done: <reason>" or "failed" for a row whose action didn't go through; "" when it did (or for older rows). */
export function auditOutcomeNote(meta: Record<string, unknown> | null | undefined): string {
  const word = OUTCOME[String(meta?.outcome ?? "")];
  if (!word) return "";
  return typeof meta?.reason === "string" && meta.reason ? `${word}: ${meta.reason}` : word;
}

const PAGE_LABEL = new Map(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label] as const)));

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  // Requests are logged as "POST /admin/shop": name the page instead.
  const m = /^(POST|PUT|PATCH|DELETE) (\/admin[^\s?]*)/.exec(action);
  if (m) {
    const href = activeHref(m[2]);
    const page = href ? PAGE_LABEL.get(href) : null;
    if (page) return `Made a change on ${page}`;
    if (m[2].startsWith("/api/admin/")) return `Admin action (${m[2].replace("/api/admin/", "").replace(/-/g, " ")})`;
  }
  return action;
}
