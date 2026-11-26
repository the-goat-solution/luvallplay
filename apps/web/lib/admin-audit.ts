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
 */
export function auditedRoute<Args extends unknown[]>(
  action: string,
  handler: (request: Request, ...args: Args) => Promise<Response>,
  /** For tests: who is asking, and where the row goes. */
  deps: { context: (request: Request) => Promise<AdminContext | null>; record: typeof recordAdminAction } = {
    context: (request) => adminContextFromCookies((n) => readCookie(request, n)),
    record: recordAdminAction,
  },
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    // Read before the handler consumes the body.
    const entries = await requestEntries(request);
    const write = async (outcome: AuditOutcome, status: number | null) => {
      const ctx = await deps.context(request).catch(() => null);
      if (!ctx) return;
      const fields = auditFields(entries);
      await deps.record(ctx, {
        action,
        target: auditTarget(entries) || new URL(request.url).pathname,
        outcome,
        meta: { ...(status === null ? {} : { status }), ...(Object.keys(fields).length ? { fields } : {}) },
      });
    };
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
