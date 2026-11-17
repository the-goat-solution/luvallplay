import { arenaExport } from "./arena-db";
import { sql } from "@vercel/postgres";
import type { Player } from "./player-db";

// Everything the club holds about a player, for "Download my data". Tables
// from features that aren't set up yet are skipped rather than failing.

async function rowsOrEmpty(query: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  try {
    const { rows } = await sql.query(query, params);
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return [];
    throw err;
  }
}

export async function collectPlayerData(player: Player): Promise<Record<string, unknown>> {
  const email = player.email;
  const [memberships, bookings, jersey, messages, orders, attendance, roundRobin, photos] = await Promise.all([
    rowsOrEmpty(
      `SELECT plan, day, status, period_start::text, period_end::text, recurring, cancel_at_period_end, created_at
       FROM memberships WHERE lower(trim(email)) = $1 ORDER BY created_at;`,
      [email],
    ),
    rowsOrEmpty(
      `SELECT session_date::text, first_name, last_name, phone, status, created_at
       FROM bookings WHERE lower(trim(email)) = $1 ORDER BY session_date;`,
      [email],
    ),
    rowsOrEmpty(
      `SELECT size, print_name, print_number, status, price_cents, created_at
       FROM jersey_registrations WHERE lower(trim(email)) = $1;`,
      [email],
    ),
    rowsOrEmpty(
      `SELECT t.subject, m.sender, m.body, m.created_at
       FROM message_threads t JOIN messages m ON m.thread_id = t.id
       WHERE t.player_id = $1 ORDER BY m.created_at;`,
      [player.id],
    ),
    rowsOrEmpty(
      `SELECT o.id, o.status, o.payment_method, o.total_cents, o.created_at, o.paid_at, o.collected_at
       FROM shop_orders o WHERE o.player_id = $1 ORDER BY o.created_at;`,
      [player.id],
    ),
    rowsOrEmpty(
      `SELECT session_date::text, source, verified, recorded_at FROM attendance WHERE email = $1 AND NOT removed ORDER BY session_date;`,
      [email],
    ),
    rowsOrEmpty(
      `SELECT session_date::text, wins, losses, points_for, points_against, rr_points, finish_place AS placing
       FROM rr_results WHERE lower(mg_name) = lower($1) ORDER BY session_date;`,
      [player.minigameName ?? ""],
    ),
    rowsOrEmpty(
      `SELECT caption, status, created_at FROM player_photos WHERE player_id = $1 AND deleted_at IS NULL ORDER BY created_at;`,
      [player.id],
    ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: player.email,
      firstName: player.firstName,
      lastName: player.lastName,
      displayName: player.displayName,
      phone: player.phone,
      phoneConfirmed: player.phoneVerified,
      language: player.lang,
      showOnLeaderboard: player.leaderboardVisible,
      createdAt: player.createdAt,
    },
    memberships,
    casualBookings: bookings,
    jerseyRegistrations: jersey,
    messages,
    shopOrders: orders,
    attendance,
    roundRobin,
    photos,
    challenges: await arenaExport(player.id).catch(() => null),
  };
}
