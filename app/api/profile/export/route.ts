import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { collectPlayerData } from "@/lib/player-export";

// "Download my data" (NZ Privacy Act 2020): everything the club holds
// under this account's email, as JSON.
export async function GET(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const data = await collectPlayerData(player);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="three-wolves-my-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
