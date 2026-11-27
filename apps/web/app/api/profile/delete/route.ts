import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { deletePlayerAccount, setPlayerAvatar } from "@/lib/player-db";
import { deletePublicBlobs } from "@/lib/public-blob";
import { clearPlayerCookies } from "@/lib/player-cookies";
import { sendAdminAlertEmail } from "@/lib/player-email";
import { endPlayerArena } from "@/lib/arena-db";
import { db } from "@/lib/admin-access";
import { sql } from "@/lib/database";
import { forgetSocial } from "@/lib/social/data-rights";
import { isLastOwner } from "@/lib/admin-roles";
import { forgetPushDevices } from "@/lib/app-push";

const bodySchema = z.object({ confirm: z.literal("DELETE") });

export async function POST(request: Request) {
  const player = await getPlayerFromRequest(request);
  if (!player) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  try {
    bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "confirm" }, { status: 400 });
  }
  // The club must always have an owner: the last one hands over first.
  if (await isLastOwner(db, player.id)) return NextResponse.json({ error: "last_owner" }, { status: 409 });
  // Their Social data goes first. If it can't, nothing else is done: the
  // account stays as it was, still signed in, and the person can try again.
  try {
    await forgetSocial(sql, player.id);
  } catch (err) {
    console.error("[profile] account not deleted: its Social data couldn't be removed:", err);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  await endPlayerArena(player.id).catch((err) => console.error("[profile] arena cleanup failed:", err));
  // The profile picture goes with the account.
  await deletePublicBlobs([await setPlayerAvatar(player.id, null).catch(() => null)]);
  await deletePlayerAccount(player.id);
  // Once more, now that no request of theirs can sign in: anything sent while the account was going.
  await forgetSocial(sql, player.id, { carry: false }).catch((err) => console.error("[profile] second Social sweep failed:", err));
  await forgetPushDevices(player.id, { all: true });
  await sendAdminAlertEmail({
    subject: `Account deleted: ${player.email}`,
    heading: "A player deleted their account",
    lines: [`${player.firstName} ${player.lastName} (${player.email}) deleted their Three Wolves account. Their payment records are kept.`],
  }).catch((err) => console.error("[profile] delete alert failed:", err));
  const response = NextResponse.json({ ok: true });
  clearPlayerCookies(response);
  return response;
}
