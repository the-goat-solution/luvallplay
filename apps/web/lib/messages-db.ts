import { sql } from "./database";

// Conversations between a player and the club admins (Account tab ↔
// /admin/inbox). One thread per topic; a reply to a closed thread reopens it.

export const MESSAGE_MAX = 4000;
export const SUBJECT_MAX = 120;

export type ThreadSummary = {
  id: number;
  subject: string;
  status: "open" | "closed";
  lastMessageAt: string;
  unread: boolean;
  preview: string;
  lastSender: "player" | "admin";
};

export type Message = {
  id: number;
  sender: "player" | "admin";
  body: string;
  createdAt: string;
};

export type ThreadDetail = {
  id: number;
  subject: string;
  status: "open" | "closed";
  messages: Message[];
};

type ThreadRow = {
  id: number;
  subject: string;
  status: string;
  last_message_at: Date;
  unread: boolean;
  preview: string | null;
  last_sender: string | null;
};

function mapSummary(r: ThreadRow): ThreadSummary {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status === "closed" ? "closed" : "open",
    lastMessageAt: new Date(r.last_message_at).toISOString(),
    unread: r.unread,
    preview: (r.preview ?? "").slice(0, 140),
    lastSender: r.last_sender === "admin" ? "admin" : "player",
  };
}

export async function listThreadsForPlayer(playerId: number): Promise<ThreadSummary[]> {
  if (!process.env.POSTGRES_URL) return [];
  const { rows } = await sql.query(
    `SELECT t.id, t.subject, t.status, t.last_message_at, t.unread_for_player AS unread,
       (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
       (SELECT sender FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender
     FROM message_threads t WHERE t.player_id = $1
     ORDER BY t.last_message_at DESC, t.id DESC LIMIT 50;`,
    [playerId],
  );
  return rows.map((r) => mapSummary(r as ThreadRow));
}

async function loadMessages(threadId: number): Promise<Message[]> {
  const { rows } = await sql`
    SELECT id, sender, body, created_at FROM messages WHERE thread_id = ${threadId} ORDER BY created_at, id;
  `;
  return rows.map((r) => ({
    id: r.id as number,
    sender: r.sender === "admin" ? "admin" : "player",
    body: r.body as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }));
}

/** A player's own thread (null if it isn't theirs). Marks it read for them. */
export async function getThreadForPlayer(playerId: number, threadId: number): Promise<ThreadDetail | null> {
  const { rows } = await sql`
    UPDATE message_threads SET unread_for_player = FALSE
    WHERE id = ${threadId} AND player_id = ${playerId}
    RETURNING id, subject, status;
  `;
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id as number,
    subject: t.subject as string,
    status: t.status === "closed" ? "closed" : "open",
    messages: await loadMessages(threadId),
  };
}

function clean(body: string, max = MESSAGE_MAX): string {
  return body.replace(/\r\n/g, "\n").trim().slice(0, max);
}

export async function createThread(input: {
  playerId: number;
  subject: string;
  body: string;
  startedBy: "player" | "admin";
}): Promise<number> {
  const fromAdmin = input.startedBy === "admin";
  const { rows } = await sql`
    INSERT INTO message_threads (player_id, subject, started_by, unread_for_admin, unread_for_player)
    VALUES (${input.playerId}, ${clean(input.subject, SUBJECT_MAX)}, ${input.startedBy}, ${!fromAdmin}, ${fromAdmin})
    RETURNING id;
  `;
  const id = rows[0].id as number;
  await sql`INSERT INTO messages (thread_id, sender, body) VALUES (${id}, ${input.startedBy}, ${clean(input.body)});`;
  return id;
}

/** Adds a player's reply to their own thread; reopens it if it was closed. */
export async function addPlayerMessage(playerId: number, threadId: number, body: string): Promise<Message | null> {
  const { rowCount } = await sql`
    UPDATE message_threads SET last_message_at = NOW(), unread_for_admin = TRUE, status = 'open'
    WHERE id = ${threadId} AND player_id = ${playerId};
  `;
  if (!rowCount) return null;
  const { rows } = await sql`
    INSERT INTO messages (thread_id, sender, body) VALUES (${threadId}, 'player', ${clean(body)})
    RETURNING id, created_at;
  `;
  return { id: rows[0].id as number, sender: "player", body: clean(body), createdAt: new Date(rows[0].created_at as Date).toISOString() };
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export type AdminThreadSummary = ThreadSummary & {
  playerId: number;
  playerName: string;
  playerEmail: string;
};

export async function listThreadsForAdmin(filter: "open" | "closed" | "all" = "open"): Promise<AdminThreadSummary[]> {
  const { rows } = await sql.query(
    `SELECT t.id, t.subject, t.status, t.last_message_at, t.unread_for_admin AS unread,
       (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
       (SELECT sender FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender,
       p.id AS player_id, p.email, trim(p.first_name || ' ' || p.last_name) AS player_name
     FROM message_threads t JOIN players p ON p.id = t.player_id
     WHERE ($1 = 'all' OR t.status = $1)
     ORDER BY t.unread_for_admin DESC, t.last_message_at DESC, t.id DESC LIMIT 200;`,
    [filter],
  );
  return rows.map((r) => ({
    ...mapSummary(r as ThreadRow),
    playerId: r.player_id as number,
    playerName: (r.player_name as string) || (r.email as string),
    playerEmail: r.email as string,
  }));
}

export async function countUnreadForAdmin(): Promise<number> {
  if (!process.env.POSTGRES_URL) return 0;
  try {
    const { rows } = await sql`SELECT count(*)::int AS n FROM message_threads WHERE unread_for_admin = TRUE;`;
    return (rows[0]?.n as number) ?? 0;
  } catch {
    return 0;
  }
}

export async function getThreadForAdmin(threadId: number): Promise<(ThreadDetail & { playerId: number; playerName: string; playerEmail: string; playerLang: string }) | null> {
  const { rows } = await sql`
    UPDATE message_threads t SET unread_for_admin = FALSE
    FROM players p
    WHERE t.id = ${threadId} AND p.id = t.player_id
    RETURNING t.id, t.subject, t.status, p.id AS player_id, p.email, p.lang,
      trim(p.first_name || ' ' || p.last_name) AS player_name;
  `;
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id as number,
    subject: t.subject as string,
    status: t.status === "closed" ? "closed" : "open",
    messages: await loadMessages(threadId),
    playerId: t.player_id as number,
    playerName: (t.player_name as string) || (t.email as string),
    playerEmail: t.email as string,
    playerLang: t.lang as string,
  };
}

export async function addAdminMessage(threadId: number, body: string): Promise<void> {
  await sql`
    UPDATE message_threads SET last_message_at = NOW(), unread_for_player = TRUE, unread_for_admin = FALSE, status = 'open'
    WHERE id = ${threadId};
  `;
  await sql`INSERT INTO messages (thread_id, sender, body) VALUES (${threadId}, 'admin', ${clean(body)});`;
}

export async function setThreadStatus(threadId: number, status: "open" | "closed"): Promise<void> {
  await sql`UPDATE message_threads SET status = ${status}, unread_for_admin = FALSE WHERE id = ${threadId};`;
}
