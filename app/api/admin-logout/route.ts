import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  appendLegacyAdminCookieClear,
} from "@/lib/admin-session";

export const runtime = "nodejs";

// Ends the admin session. Deliberately requires no valid session of its own:
// the main reason to reach for it is that something is already wrong with the
// cookie — a stale one from an older build, or a session the server no longer
// accepts — and gating logout behind the auth it's meant to repair would make
// it useless exactly when it's needed.
export async function POST(request: Request) {
  const response = NextResponse.redirect(
    new URL("/admin/login?breakglass=1&loggedOut=1", request.url),
    303,
  );
  response.cookies.set(ADMIN_COOKIE, "", {
    ...adminCookieOptions(),
    maxAge: 0,
  });
  appendLegacyAdminCookieClear(response);
  return response;
}
