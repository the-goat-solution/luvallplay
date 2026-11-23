import { NextResponse } from "next/server";
import { hideFromLeaderboardByToken } from "@/lib/repos/players";
import { revalidateTag } from "next/cache";

// One-click "Hide me from the leaderboard" link in the welcome email.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (token.length >= 20 && token.length <= 100) {
    await hideFromLeaderboardByToken(token);
    revalidateTag("leaderboard", { expire: 0 });
  }
  return NextResponse.redirect(new URL("/?hidden=1#leaderboard", url), 303);
}
