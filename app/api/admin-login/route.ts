import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/security";

export const runtime = "nodejs";

const COOKIE_NAME = "admin_token";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-login:${ip}`, 10)) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url), 303);
  }

  const password = process.env.ADMIN_PASSWORD;
  const form = await request.formData();
  const submitted = form.get("password");

  if (!password || typeof submitted !== "string" || submitted !== password) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/admin/play-days", request.url), 303);
  response.cookies.set(COOKIE_NAME, password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
