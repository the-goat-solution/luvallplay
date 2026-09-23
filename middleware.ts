import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  appendLegacyAdminCookieClear,
  signAdminToken,
  verifyAdminToken,
} from "@/lib/admin-session";

export const config = {
  matcher: "/admin/:path*",
};

export async function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse("Admin access is not configured", { status: 503 });
  }

  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifyAdminToken(token)) {
    // Sliding expiry: loading any admin page counts as activity and pushes
    // the deadline out another 48 hours. A session only lapses once nobody
    // has touched the admin area for that long.
    const response = NextResponse.next();
    const refreshed = await signAdminToken();
    if (refreshed) {
      response.cookies.set(ADMIN_COOKIE, refreshed, adminCookieOptions());
    }
    return response;
  }

  // Distinguish "your session ran out" from "you were never logged in", so
  // the login page can explain why someone was bounced mid-session rather
  // than leaving them wondering. Only a cookie that was actually present
  // (and is now invalid or expired) counts as a timeout.
  const loginUrl = new URL("/admin/login", request.url);
  if (token) loginUrl.searchParams.set("expired", "1");

  // 303 on a non-GET so the browser retries the login page as a GET. A
  // default 307 preserves the method, which would POST an expired form (or
  // a Server Action) at a page route that only answers GET.
  const response = NextResponse.redirect(
    loginUrl,
    request.method === "GET" ? 307 : 303,
  );
  // Clear the dead cookie so the next request is a clean "not logged in"
  // rather than repeatedly re-reporting an expiry.
  response.cookies.set(ADMIN_COOKIE, "", {
    ...adminCookieOptions(),
    maxAge: 0,
  });
  // Also drop the legacy "/admin"-scoped cookie if one is still around: the
  // browser sends it ahead of the "/" one on admin pages, so leaving it in
  // place would keep failing verification on every retry.
  appendLegacyAdminCookieClear(response);
  return response;
}
