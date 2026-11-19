import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getPlayerFromRequest } from "@/lib/player-auth";
import { ensurePlayerTables } from "@/lib/player-db";
import { DISPLAY_NAME_SQL } from "@/lib/stats-periods";

// Wolf Vision set-up: the registered players ("wolves") a signed-in player can
// put on court. Display name and picture only, never an email.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return NextResponse.json({ players: [] });
  const me = await getPlayerFromRequest(request);
  if (!me) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  await ensurePlayerTables();
  const { rows } = await sql.query(
    `SELECT p.id, ${DISPLAY_NAME_SQL} AS name, p.avatar_url FROM players p
     WHERE p.deleted_at IS NULL AND (trim(p.first_name) <> '' OR trim(coalesce(p.display_name, '')) <> '')
     ORDER BY lower(${DISPLAY_NAME_SQL}) LIMIT 2000;`,
  );
  return NextResponse.json(
    { players: rows.map((r) => ({ id: Number(r.id), name: String(r.name), avatarUrl: (r.avatar_url as string | null) ?? null, me: Number(r.id) === me.id })) },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
