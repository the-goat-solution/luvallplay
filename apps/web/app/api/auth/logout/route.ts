import { NextResponse } from "next/server";
import { PLAYER_COOKIE, endAllPlayerSessions, endPlayerSession, getPlayerFromRequest } from "@/lib/player-auth";
import { clearPlayerCookies } from "@/lib/player-cookies";
import { forgetPushDevices } from "@/lib/app-push";

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// A plain form post, so signing out works without JavaScript.
// ?all=1 signs out every device.
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "1") {
    const player = await getPlayerFromRequest(request);
    if (player) {
      await endAllPlayerSessions(player.id);
      // Every device: their phones stop receiving notifications too.
      await forgetPushDevices(player.id, { all: true });
    }
  } else {
    await endPlayerSession(readCookie(request, PLAYER_COOKIE));
  }
  const response = NextResponse.redirect(new URL("/login?signed_out=1", url), 303);
  clearPlayerCookies(response);
  return response;
}
