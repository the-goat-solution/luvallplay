import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  appendLegacyAdminCookieClear,
  signAdminToken,
} from "@/lib/admin-session";
import { audit, resolveAdmin } from "@/lib/admin-access";
import { summarizeAdminRequest } from "@/lib/admin-roles";

// Node runtime (stable since Next.js 15.5): the admin check reads the
// player's session and role from the database, and it has to happen here,
// because admin Server Actions post straight to the page URL.
export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*", "/profile", "/profile/:path*"],
  runtime: "nodejs",
};

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
  const response = redirectTo(request, url);
  // A dead break-glass cookie is cleared so it stops being re-checked.
  if (request.cookies.get(ADMIN_COOKIE)) {
    response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
    appendLegacyAdminCookieClear(response);
  }
  return response;
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

  // The old password page. Admin is now reached by signing in as yourself;
  // the password form stays reachable at /admin/login?breakglass=1 for two
  // weeks after the switch-over (break-glass), then it's removed.
  if (path === "/admin/login") {
    if (request.nextUrl.searchParams.get("breakglass") === "1" && process.env.ADMIN_PASSWORD) return NextResponse.next();
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

  const response = NextResponse.next();
  if (verdict.ctx.kind === "break-glass") {
    // Sliding expiry: any admin page pushes the 48-hour deadline out again.
    const refreshed = await signAdminToken();
    if (refreshed) response.cookies.set(ADMIN_COOKIE, refreshed, adminCookieOptions());
  }
  return response;
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/profile" || request.nextUrl.pathname.startsWith("/profile/")) {
    return guardProfile(request);
  }
  return guardAdmin(request);
}
