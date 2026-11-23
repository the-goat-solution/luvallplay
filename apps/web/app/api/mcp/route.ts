import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  attendanceData,
  leaderboardData,
  logActivity,
  meData,
  myUpcomingPlayDays,
  requireScope,
  roundRobinData,
  statsData,
  upcomingSessionsData,
  type ApiCaller,
} from "@/lib/api-v1";
import type { Scope } from "@/lib/webhooks";

// A small Model Context Protocol server (Streamable HTTP transport, JSON
// responses, stateless), so an AI assistant can read a player's play days
// and round robin results. Auth: an access key from the profile as
// "Authorization: Bearer tw_…" — the same keys and permissions as /api/v1.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Tool = {
  name: string;
  description: string;
  scope: Scope | null;
  inputSchema: Record<string, unknown>;
  run: (caller: ApiCaller | null, args: Record<string, unknown>) => Promise<unknown>;
};

const noArgs = { type: "object", properties: {}, additionalProperties: false };

const TOOLS: Tool[] = [
  {
    name: "get_my_profile",
    description: "The player's display name and current Three Wolves membership (plan, day, dates, auto-renew).",
    scope: "read:stats",
    inputSchema: noArgs,
    run: (c) => meData(c!),
  },
  {
    name: "get_my_stats",
    description: "Play days attended (this month, quarter, year, all time), week streak, round robin totals and leaderboard ranks.",
    scope: "read:stats",
    inputSchema: noArgs,
    run: (c) => statsData(c!),
  },
  {
    name: "get_attendance",
    description: "Dates the player played at Three Wolves, newest first. Optional from/to dates (YYYY-MM-DD).",
    scope: "read:attendance",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Earliest date, YYYY-MM-DD" },
        to: { type: "string", description: "Latest date, YYYY-MM-DD" },
      },
      additionalProperties: false,
    },
    run: (c, a) => attendanceData(c!, a.from as string | undefined, a.to as string | undefined),
  },
  {
    name: "get_round_robin_results",
    description: "The player's round robin (mini game) results per day: points (2 per win), wins, losses, placing.",
    scope: "read:attendance",
    inputSchema: noArgs,
    run: (c) => roundRobinData(c!),
  },
  {
    name: "get_my_upcoming_play_days",
    description: "Upcoming play days the player is in (membership days they haven't opted out of, and casual bookings).",
    scope: "read:calendar",
    inputSchema: noArgs,
    run: (c) => myUpcomingPlayDays(c!),
  },
  {
    name: "get_leaderboard",
    description: "The public club leaderboard. metric: attendance or rr (round robin points). period: month, quarter, year or lifetime.",
    scope: null,
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["attendance", "rr"] },
        period: { type: "string", enum: ["month", "quarter", "year", "lifetime"] },
        key: { type: "string", description: "A past period, e.g. 2026-11, 2026-Q3, 2025" },
      },
      additionalProperties: false,
    },
    run: (_c, a) => leaderboardData(a.metric as string, a.period as string, a.key as string | undefined),
  },
  {
    name: "get_upcoming_sessions",
    description: "The club's upcoming play days with times, venue and casual spots left.",
    scope: null,
    inputSchema: { type: "object", properties: { days: { type: "number", minimum: 1, maximum: 60 } }, additionalProperties: false },
    run: (_c, a) => upcomingSessionsData(Number(a.days) || 30),
  },
  {
    name: "log_activity",
    description: "Record that the player played on a date (YYYY-MM-DD, a club play day in the last 60 days). Saved unconfirmed until a club admin confirms it.",
    scope: "write:activity",
    inputSchema: { type: "object", properties: { date: { type: "string" } }, required: ["date"], additionalProperties: false },
    run: (c, a) => logActivity(c!, String(a.date ?? "")),
  },
];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function result(id: RpcRequest["id"], value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}
function error(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handle(request: Request, msg: RpcRequest): Promise<object | null> {
  if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return result(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "three-wolves-badminton", title: "Three Wolves Badminton Club", version: "1.0.0" },
        instructions:
          "Three Wolves Badminton Club (Christchurch, NZ). Tools read the signed-in player's play days, round robin results and the club leaderboard. Dates are New Zealand dates (YYYY-MM-DD).",
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return error(msg.id, -32602, `Unknown tool: ${name}`);
      let caller: ApiCaller | null = null;
      if (tool.scope) {
        const auth = await requireScope(request, tool.scope);
        if (auth instanceof Response) {
          const body = (await auth.json().catch(() => ({}))) as { message?: string; error?: string };
          return result(msg.id, { content: [{ type: "text", text: body.message ?? body.error ?? "Not allowed" }], isError: true });
        }
        caller = auth;
      }
      try {
        const data = await tool.run(caller, (msg.params?.arguments as Record<string, unknown>) ?? {});
        return result(msg.id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: Array.isArray(data) ? { items: data } : (data as object),
        });
      } catch (err) {
        return result(msg.id, { content: [{ type: "text", text: (err as Error).message }], isError: true });
      }
    }
    default:
      return error(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Stateless server: no server-initiated stream.
export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function POST(request: Request) {
  let payload: RpcRequest | RpcRequest[];
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(error(null, -32700, "Parse error"), { status: 400, headers: CORS_HEADERS });
  }
  const batch = Array.isArray(payload) ? payload : [payload];
  if (batch.some((m) => m?.jsonrpc !== "2.0" || typeof m.method !== "string")) {
    return NextResponse.json(error(null, -32600, "Invalid Request"), { status: 400, headers: CORS_HEADERS });
  }
  const responses = (await Promise.all(batch.map((m) => handle(request, m)))).filter((r): r is object => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return NextResponse.json(Array.isArray(payload) ? responses : responses[0], { headers: CORS_HEADERS });
}
