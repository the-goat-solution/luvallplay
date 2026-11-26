// Per-action audit rows with the outcome (audit H7, 25 Nov 2026; build plan
// §6.2.4 layer 2: "actions that write the audit log").
//
// The middleware writes one generic row for every admin POST before it runs
// ("POST /admin/members"). That says someone tried; it can't say what
// happened, and it never sees a GET, so exports went unrecorded. The helpers
// here write a named row AFTER the action, with its outcome:
//
//   ok       it was done
//   refused  the request was understood and turned down (a rule, a missing record)
//   failed   something broke (the payment provider, the database)
//
// Only allow-listed fields are kept (AUDIT_FIELD_ALLOW_LIST in admin-roles.ts):
// ids and choices, never free text.
import { isActionStepUpFresh } from "@luvallplay/auth";
import { audit, adminContextFromCookies, readCookie, type AdminContext } from "./admin-access";
import { auditFields, auditTarget } from "./admin-roles";

export type AuditOutcome = "ok" | "refused" | "failed";

export type ActionRecord = {
  /** A stable code, "<area>.<what>": "membership.cancel", "export.finance". Labelled in lib/admin-audit-labels.ts. */
  action: string;
  target?: string;
  outcome: AuditOutcome;
  /** Short, plain reason when it wasn't done. Never a person's details. */
  reason?: string;
  meta?: Record<string, unknown>;
};

/** Write one action's row. Never throws: a logging failure must not break the action. */
export async function recordAdminAction(ctx: AdminContext | null, r: ActionRecord): Promise<void> {
  await audit(ctx, {
    action: r.action.slice(0, 200),
    target: r.target || null,
    meta: { ...(r.meta ?? {}), outcome: r.outcome, ...(r.reason ? { reason: r.reason.slice(0, 200) } : {}) },
  });
}

export const STEP_UP_REASON = "asked for a fresh sign-in code";

/** Where the code screen is, coming back to `next` (an admin page) afterwards. */
export function actionStepUpUrl(next: string): string {
  return `/login?stepup=action&next=${encodeURIComponent(next)}`;
}

/** The admin page an export link was clicked on (same origin only), to return to after the code. */
function backTo(request: Request): string {
  try {
    const referer = new URL(request.headers.get("referer") ?? "");
    if (referer.origin === new URL(request.url).origin && referer.pathname.startsWith("/admin")) return referer.pathname + referer.search;
  } catch {
    // No or unreadable referer.
  }
  return "/admin";
}

function outcomeOf(status: number): AuditOutcome {
  if (status < 400) return "ok";
  return status < 500 ? "refused" : "failed";
}

async function requestEntries(request: Request): Promise<[string, string][]> {
  const entries: [string, string][] = [...new URL(request.url).searchParams.entries()];
  if (request.method === "GET" || request.method === "HEAD") return entries;
  if (Number(request.headers.get("content-length") ?? "0") > 64_000) return entries;
  try {
    const body = JSON.parse(await request.clone().text()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body)) entries.push([k, typeof v === "string" ? v : (JSON.stringify(v) ?? "")]);
    }
  } catch {
    // Not JSON: the row is still written, without fields.
  }
  return entries;
}

/**
 * Wrap an /api/admin route handler so every call by a signed-in admin leaves
 * a row named `action` with the outcome (from the response status), GETs
 * included. Calls by someone who isn't signed in are refused by the handler
 * and the middleware as before, and aren't an admin's action, so they write
 * nothing.
 *
 *   export const POST = auditedRoute("membership.cancel", async (request) => { … });
 *
 * With `stepUp: true` the route is a sensitive action (audit H8): it also
 * needs a sign-in code entered in the last five minutes. Without one the
 * handler doesn't run and a "not done" row is written; a page navigation
 * (an export link) goes to the code screen and back to the page it came
 * from, anything else gets 401 { error: "step_up", scope: "action" } (the
 * admin buttons already send a 401 to the code screen).
 */
export function auditedRoute<Args extends unknown[]>(
  action: string,
  handler: (request: Request, ...args: Args) => Promise<Response>,
  options: {
    /** A sensitive action: needs a code entered in the last five minutes. */
    stepUp?: boolean;
    /** For tests: who is asking, where the row goes, and the time. */
    deps?: { context: (request: Request) => Promise<AdminContext | null>; record: typeof recordAdminAction; now?: () => number };
  } = {},
): (request: Request, ...args: Args) => Promise<Response> {
  const deps = options.deps ?? {
    context: (request: Request) => adminContextFromCookies((n) => readCookie(request, n)),
    record: recordAdminAction,
  };
  return async (request, ...args) => {
    // Read before the handler consumes the body.
    const entries = await requestEntries(request);
    const ctx = await deps.context(request).catch(() => null);
    const write = async (outcome: AuditOutcome, status: number | null, reason?: string) => {
      if (!ctx) return;
      const fields = auditFields(entries);
      await deps.record(ctx, {
        action,
        target: auditTarget(entries) || new URL(request.url).pathname,
        outcome,
        ...(reason ? { reason } : {}),
        meta: { ...(status === null ? {} : { status }), ...(Object.keys(fields).length ? { fields } : {}) },
      });
    };
    if (options.stepUp && ctx && !isActionStepUpFresh(ctx.signedInAt, deps.now?.() ?? Date.now())) {
      const navigation = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
      await write("refused", navigation ? 303 : 401, STEP_UP_REASON);
      if (navigation) return Response.redirect(new URL(actionStepUpUrl(backTo(request)), request.url), 303);
      return Response.json({ error: "step_up", scope: "action" }, { status: 401 });
    }
    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch (err) {
      await write("failed", null);
      throw err;
    }
    await write(outcomeOf(response.status), response.status);
    return response;
  };
}
