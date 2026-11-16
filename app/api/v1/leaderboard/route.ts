import { CORS_HEADERS, json, leaderboardData } from "@/lib/api-v1";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Public: ?metric=attendance|rr&period=month|quarter|year|lifetime&key=2026-11
export async function GET(request: Request) {
  if (!process.env.POSTGRES_URL) return json({ error: "unavailable" }, 503);
  const url = new URL(request.url);
  return json(await leaderboardData(url.searchParams.get("metric"), url.searchParams.get("period"), url.searchParams.get("key")));
}
