import { activeHref } from "@/components/admin/nav-config";
import { NAV_GROUPS } from "@/components/admin/nav-registry";

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
};

const PAGE_LABEL = new Map(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label] as const)));

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  // Requests are logged as "POST /admin/shop": name the page instead.
  const m = /^(POST|PUT|PATCH|DELETE) (\/admin[^\s?]*)/.exec(action);
  if (m) {
    const href = activeHref(m[2], NAV_GROUPS);
    const page = href ? PAGE_LABEL.get(href) : null;
    if (page) return `Made a change on ${page}`;
    if (m[2].startsWith("/api/admin/")) return `Admin action (${m[2].replace("/api/admin/", "").replace(/-/g, " ")})`;
  }
  return action;
}
