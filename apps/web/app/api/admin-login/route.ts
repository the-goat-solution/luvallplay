import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/security";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  appendLegacyAdminCookieClear,
  signAdminToken,
} from "@/lib/admin-session";
import { audit } from "@/lib/admin-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-login:${ip}`, 10)) {
    return NextResponse.redirect(new URL("/admin/login?breakglass=1&error=1", request.url), 303);
  }

  const password = process.env.ADMIN_PASSWORD;
  const form = await request.formData();
  const submitted = form.get("password");

  if (!password || typeof submitted !== "string" || submitted !== password) {
    return NextResponse.redirect(new URL("/admin/login?breakglass=1&error=1", request.url), 303);
  }

  const token = await signAdminToken();
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?breakglass=1&error=1", request.url), 303);
  }

  // Break-glass: kept for two weeks after admin moved to player accounts.
  await audit({ kind: "break-glass" }, { action: "admin.break_glass_login" });
  const response = NextResponse.redirect(new URL("/admin/play-days", request.url), 303);
  // A signed, self-expiring token rather than the password itself — see
  // lib/admin-session.ts. The 48-hour window slides forward on every
  // authenticated admin request.
  response.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
  appendLegacyAdminCookieClear(response);
  return response;
}
