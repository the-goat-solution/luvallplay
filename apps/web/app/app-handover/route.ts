import { NextResponse } from "next/server";
import { readCookie } from "@/lib/admin-access";
import { createAppHandover, handoverScreen, playerAppUrl } from "@/lib/app-handover";
import { PLAYER_COOKIE, sessionForToken } from "@/lib/player-auth";
import { recordPlayerEvent } from "@/lib/player-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The cutover's handover, website side (phase-4-cutover.md §4.1):
// /app-handover?to=<app screen>. Signed in on the website: a single-use,
// 60-second token, and the browser goes to the app's /handover with the token
// after `#` (never sent to a server, never in a referrer). Signed out: the
// app's sign-in, which opens that screen afterwards.
//
// Off until the players' app address is set (PLAYER_APP_URL): then it goes to
// /profile, exactly as the website does today. Pointing /profile here is a
// separate cutover step, asked of the owner.
export async function GET(request: Request) {
  const app = playerAppUrl();
  if (!app) return NextResponse.redirect(new URL("/profile", request.url), 303);
  const to = handoverScreen(new URL(request.url).searchParams.get("to"));
  const session = await sessionForToken(readCookie(request, PLAYER_COOKIE));
  let target: string;
  if (session) {
    const token = await createAppHandover(session.player.id, session.signedInAt);
    await recordPlayerEvent(session.player.id, "app_handover_made");
    target = `${app}/handover#t=${token}&to=${encodeURIComponent(to)}`;
  } else {
    target = to === "/home" ? `${app}/signin` : `${app}/signin?next=${encodeURIComponent(to)}`;
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
