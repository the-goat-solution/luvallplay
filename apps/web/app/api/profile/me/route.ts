import { NextResponse } from "next/server";
import { getPlayerFromRequest } from "@/lib/player-auth";

// Lets the main site's booking and membership forms pre-fill (and lock) the
// signed-in player's details.
export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ signedIn: false });
  const player = await getPlayerFromRequest(request).catch(() => null);
  if (!player) return NextResponse.json({ signedIn: false }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    {
      signedIn: true,
      firstName: player.firstName,
      lastName: player.lastName,
      email: player.email,
      phone: player.phone ?? "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
