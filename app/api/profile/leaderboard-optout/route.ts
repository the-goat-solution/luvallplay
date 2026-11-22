import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { revalidateTag } from "next/cache";
import { ensurePlayerTables } from "@/lib/player-db";

// One-click "Hide me from the leaderboard" link in the welcome email.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (token.length >= 20 && token.length <= 100) {
    await ensurePlayerTables();
    await sql`UPDATE players SET leaderboard_visible = FALSE WHERE leaderboard_optout_token = ${token};`;
    revalidateTag("leaderboard");
  }
  return NextResponse.redirect(new URL("/?hidden=1#leaderboard", url), 303);
}
