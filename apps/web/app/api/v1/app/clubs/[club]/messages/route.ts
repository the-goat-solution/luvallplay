import { appRoute } from "@/lib/app-api";
import { notifyAdminsOfPlayerMessage } from "@/lib/message-notify";
import { createThread, listThreadsForPlayer } from "@/lib/messages-db";

// The inbox: the person's conversations with the club, and starting a new
// one. The web's /api/profile/messages, with the same limits (shared bucket).
const list = appRoute("messages.list", async ({ player }) => {
  const threads = await listThreadsForPlayer(player.id);
  return {
    threads: threads.map((t) => ({ id: t.id, subject: t.subject, preview: t.preview, unread: t.unread, lastMessageAt: t.lastMessageAt, status: t.status, lastSender: t.lastSender })),
  };
});

const start = appRoute(
  "messages.start",
  async ({ player, body }) => {
    const id = await createThread({ playerId: player.id, subject: body.subject, body: body.body, startedBy: "player" });
    await notifyAdminsOfPlayerMessage({
      threadId: id,
      playerName: `${player.firstName} ${player.lastName}`.trim() || player.email,
      playerEmail: player.email,
      subject: body.subject,
      body: body.body,
    });
    return { ok: true as const, id };
  },
  { rateKey: (_ip, session) => `msg-new:${session?.player.id}` },
);

export const GET = list.handle;
export const POST = start.handle;
export const OPTIONS = list.preflight;
