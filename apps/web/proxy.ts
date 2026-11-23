// First: choose the database before any import below can connect.
import "@/lib/db-env";
import { NextResponse, type NextRequest } from "next/server";
import { audit, resolveAdmin } from "@/lib/admin-access";
import { summarizeAdminRequest } from "@/lib/admin-roles";
import { moduleBlocking } from "@/lib/club-modules";
import { sql } from "@/lib/database";

// The proxy (Next.js 16's name for middleware) runs on the Node runtime: the
// admin check reads the player's session and role from the database, and it
// has to happen here, because admin Server Actions post straight to the page
// URL.
//
// Phase 3 step 5: it also stops a path whose module is switched off for the
// club (packages/modules/src/routes.ts says who owns what). The matcher has
// to be written out literally; tests/module-enforcement.test.ts checks that
// it covers every prefix a module owns.
export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/profile",
    "/profile/:path*",
    "/api/:path*",
    "/challenges",
    "/challenges/:path*",
    "/casual-play",
    "/casual-play/:path*",
    "/mini-game",
    "/mini-game/:path*",
    "/gallery",
    "/gallery/:path*",
    "/jersey",
    "/jersey/:path*",
    "/renew-membership",
    "/renew-membership/:path*",
    "/cancel-membership",
    "/cancel-membership/:path*",
  ],
};

// A module that is off isn't there: the same answer as a page that doesn't
// exist. Its data is kept and comes back when the module is switched on.
function notFound(api: boolean): NextResponse {
  if (api) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px}</style></head>
<body><h1 style="font-size:20px">Page not found</h1>
<p>This page isn't available.</p>
<p lang="vi">Trang này hiện không có.</p>
<p><a href="/">← Home</a></p></body></html>`;
  return new NextResponse(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Player profile pages: only checks a session cookie is present, so signed-
// out visitors go straight to sign-in. The session itself is verified (and
// refreshed) by the page against the database.
function guardProfile(request: NextRequest): NextResponse {
  if (request.cookies.get("tw_player")?.value) return NextResponse.next();
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl, request.method === "GET" ? 307 : 303);
}

// Reached with a handoff token instead of a cookie; they check it themselves.
const ADMIN_EXEMPT = new Set(["/admin/handoff", "/api/admin/handoff"]);

// 303 on a non-GET so the browser retries as a GET. A default 307 preserves
// the method, which would POST an expired form (or a Server Action) at a
// page route that only answers GET.
function redirectTo(request: NextRequest, url: URL): NextResponse {
  return NextResponse.redirect(url, request.method === "GET" ? 307 : 303);
}

function loginRedirect(request: NextRequest, stepUp: boolean): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  if (stepUp) url.searchParams.set("stepup", "1");
  return redirectTo(request, url);
}

function forbidden(api: boolean): NextResponse {
  if (api) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No admin access</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#0e2c3f}a{color:#0e2c3f}</style></head>
<body><h1 style="font-size:20px">No admin access</h1>
<p>Your account doesn't have access to this part of admin. An owner can give you access from Admin → People → Admins.</p>
<p lang="vi">Tài khoản của bạn không có quyền vào phần quản trị này. Chủ câu lạc bộ có thể cấp quyền trong Admin → People → Admins.</p>
<p><a href="/profile">← My Three Wolves</a></p></body></html>`;
  return new NextResponse(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Form fields of an admin POST for the audit log (small bodies only; uploads are skipped). */
async function postedFields(request: NextRequest): Promise<[string, string][]> {
  const type = request.headers.get("content-type") ?? "";
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 64_000) return [];
  try {
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await request.clone().formData();
      return [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]);
    }
    if (type.includes("json") || type.includes("text/plain")) {
      const body = JSON.parse(await request.clone().text()) as unknown;
      if (body && typeof body === "object") {
        return Object.entries(Array.isArray(body) ? { ...body } : body).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v) ?? ""]);
      }
    }
  } catch {
    // Unreadable body: the action is still logged, just without fields.
  }
  return [];
}

async function guardAdmin(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const api = path.startsWith("/api/admin");

  // The old password page: admin is reached by signing in as yourself.
  if (path === "/admin/login") {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", "/admin");
    return redirectTo(request, url);
  }
  if (ADMIN_EXEMPT.has(path)) return NextResponse.next();

  const verdict = await resolveAdmin((name) => request.cookies.get(name)?.value, path, api);
  if (!verdict.ok) {
    if (verdict.reason === "signed_out") {
      return api ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : loginRedirect(request, false);
    }
    if (verdict.reason === "step_up") {
      return api ? NextResponse.json({ error: "step_up" }, { status: 401 }) : loginRedirect(request, true);
    }
    return forbidden(api);
  }

  // Every admin action (anything but a read) is on record.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const summary = summarizeAdminRequest({
      method: request.method,
      path,
      actionId: request.headers.get("next-action"),
      fields: await postedFields(request),
    });
    await audit(verdict.ctx, summary);
  }

  return NextResponse.next();
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // First: is this path's module on for the club? (Never throws; a database
  // problem counts every module as on.)
  if (await moduleBlocking(sql, path)) return notFound(path.startsWith("/api/"));

  if (path === "/profile" || path.startsWith("/profile/")) return guardProfile(request);
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) return guardAdmin(request);
  return NextResponse.next();
}
