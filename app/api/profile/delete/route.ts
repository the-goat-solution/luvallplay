import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { deletePlayerAccount } from "@/lib/player-db";
import { clearPlayerCookies } from "@/lib/player-cookies";
import { sendAdminAlertEmail } from "@/lib/player-email";

const bodySchema = z.object({ confirm: z.literal("DELETE") });

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  try {
    bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "confirm" }, { status: 400 });
  }
  await deletePlayerAccount(player.id);
  await sendAdminAlertEmail({
    subject: `Account deleted: ${player.email}`,
    heading: "A player deleted their account",
    lines: [`${player.firstName} ${player.lastName} (${player.email}) deleted their Three Wolves account. Their payment records are kept.`],
  }).catch((err) => console.error("[profile] delete alert failed:", err));
  const response = NextResponse.json({ ok: true });
  clearPlayerCookies(response);
  return response;
}
