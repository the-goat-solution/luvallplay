import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { recordPlayerEvent } from "@/lib/player-db";

// Install-guide and welcome-card events from the profile app shell.
const bodySchema = z.object({
  event: z.enum([
    "install_hint_shown",
    "install_hint_dismissed",
    "install_hint_timeout",
    "install_accepted",
    "opened_homescreen",
    "welcome_dismissed",
  ]),
  detail: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (body.event === "install_hint_shown") {
    await sql`UPDATE players SET install_hint_shown_at = coalesce(install_hint_shown_at, NOW()) WHERE id = ${player.id};`;
  } else if (body.event === "opened_homescreen" || body.event === "install_accepted") {
    // Once installed there's nothing to show, so the guide counts as shown too.
    await sql`
      UPDATE players SET installed_at = coalesce(installed_at, NOW()),
        install_hint_shown_at = coalesce(install_hint_shown_at, NOW())
      WHERE id = ${player.id};
    `;
  } else if (body.event === "welcome_dismissed") {
    await sql`UPDATE players SET welcome_card_dismissed_at = coalesce(welcome_card_dismissed_at, NOW()) WHERE id = ${player.id};`;
  }
  await recordPlayerEvent(player.id, body.event, body.detail);
  return NextResponse.json({ ok: true });
}
