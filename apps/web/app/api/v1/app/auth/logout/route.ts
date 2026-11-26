import { NextResponse } from "next/server";
import { appRoute } from "@/lib/app-api";
import { forgetPushDevices } from "@/lib/app-push";
import { endAllPlayerSessions, endPlayerSession } from "@/lib/player-auth";
import { clearPlayerCookies } from "@/lib/player-cookies";

// Ends this session, or every session of the person with { all: true }.
// The store app sends its push address so the phone stops receiving as well.
const route = appRoute("auth.logout", async ({ body, player, session }) => {
  if (body.all) await endAllPlayerSessions(player.id);
  else await endPlayerSession(session!.token);
  // Signed out: this device (or every device) stops receiving notifications too.
  await forgetPushDevices(player.id, body.all ? { all: true } : { token: body.pushToken });
  return { ok: true as const };
});

export async function POST(request: Request): Promise<Response> {
  const response = await route.handle(request);
  // Signed out with the web's cookie: clear it too.
  if (response.ok && /(^|;\s*)tw_player=/.test(request.headers.get("cookie") ?? "")) clearPlayerCookies(response as NextResponse);
  return response;
}
export const OPTIONS = route.preflight;
