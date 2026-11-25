import { appRoute, fail } from "@/lib/app-api";
import { notifyAdminsOfPlayerMessage } from "@/lib/message-notify";
import { addPlayerMessage, getThreadForPlayer } from "@/lib/messages-db";

// One conversation (reading it marks it read) and replying to it, which
// reopens a closed one. Only the person's own conversations exist here.
const read = appRoute("messages.thread", async ({ player, params }) => {
  const thread = await getThreadForPlayer(player.id, params.id);
  return thread ? { thread } : fail(404, "not_found");
});

const reply = appRoute(
  "messages.reply",
  async ({ player, params, body }) => {
    const message = await addPlayerMessage(player.id, params.id, body.body);
    if (!message) return fail(404, "not_found");
    const thread = await getThreadForPlayer(player.id, params.id);
    await notifyAdminsOfPlayerMessage({
      threadId: params.id,
      playerName: `${player.firstName} ${player.lastName}`.trim() || player.email,
      playerEmail: player.email,
      subject: thread?.subject ?? "Message",
      body: body.body,
    });
    return { ok: true as const, message };
  },
  { rateKey: (_ip, session) => `msg:${session?.player.id}` },
);

export const GET = read.handle;
export const POST = reply.handle;
export const OPTIONS = read.preflight;
