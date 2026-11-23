import { NextResponse } from "next/server";
import { endSessionFromRequest, createPlayerSession, safeNextPath, verifyLinkToken } from "@/lib/player-auth";
import { ensurePlayerForEmail } from "@/lib/player-db";
import { setPlayerCookies } from "@/lib/player-cookies";

// The one-tap "Sign in" button in the code email.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const result = await verifyLinkToken(url.searchParams.get("token") ?? "");
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?expired=1&next=${encodeURIComponent(next)}`, url), 303);
  }
  const { player } = await ensurePlayerForEmail(result.email, { via: "signup" });
  await endSessionFromRequest(request);
  const token = await createPlayerSession(player.id, request.headers.get("user-agent"));
  const target = player.firstName.trim() ? next : `/login/details?next=${encodeURIComponent(next)}`;
  const response = NextResponse.redirect(new URL(target, url), 303);
  setPlayerCookies(response, token);
  return response;
}
