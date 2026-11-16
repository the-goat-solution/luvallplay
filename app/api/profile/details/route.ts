import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { toE164, updatePlayerProfile } from "@/lib/player-db";

const bodySchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).default(""),
  displayName: z.string().trim().max(40).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  lang: z.enum(["en", "vi"]).default("en"),
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
  if (body.phone && !toE164(body.phone)) {
    return NextResponse.json({ error: "invalid_number" }, { status: 400 });
  }
  await updatePlayerProfile(player.id, {
    firstName: body.firstName,
    lastName: body.lastName,
    displayName: body.displayName ?? null,
    phone: body.phone ?? null,
    lang: body.lang,
  });
  return NextResponse.json({ ok: true });
}
