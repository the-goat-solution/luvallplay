import type { NextResponse } from "next/server";
import { PLAYER_COOKIE, playerCookieOptions } from "./player-auth";

// The session cookie is httpOnly. A second, readable "hint" cookie (no
// secret in it) lets the static site header show "My profile" instead of
// "Log in" without a server round trip.
export const PLAYER_HINT_COOKIE = "tw_signed_in";

export function setPlayerCookies(response: NextResponse, token: string): void {
  response.cookies.set(PLAYER_COOKIE, token, playerCookieOptions());
  response.cookies.set(PLAYER_HINT_COOKIE, "1", { ...playerCookieOptions(), httpOnly: false });
}

export function clearPlayerCookies(response: NextResponse): void {
  response.cookies.set(PLAYER_COOKIE, "", { ...playerCookieOptions(0) });
  response.cookies.set(PLAYER_HINT_COOKIE, "", { ...playerCookieOptions(0), httpOnly: false });
}
