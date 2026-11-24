import { NextResponse } from "next/server";
import { appRoute } from "@/lib/app-api";
import { endAllPlayerSessions, endPlayerSession } from "@/lib/player-auth";
import { clearPlayerCookies } from "@/lib/player-cookies";

// Ends this session, or every session of the person with { all: true }.
const route = appRoute("auth.logout", async ({ body, player, session }) => {
  if (body.all) await endAllPlayerSessions(player.id);
  else await endPlayerSession(session!.token);
  return { ok: true as const };
});

export async function POST(request: Request): Promise<Response> {
  const response = await route.handle(request);
  // Signed out with the web's cookie: clear it too.
  if (response.ok && /(^|;\s*)tw_player=/.test(request.headers.get("cookie") ?? "")) clearPlayerCookies(response as NextResponse);
  return response;
}
export const OPTIONS = route.preflight;
