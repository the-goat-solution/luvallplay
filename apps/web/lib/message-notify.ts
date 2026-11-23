import { sendAdminAlertEmail, sendPlayerNoticeEmail } from "./player-email";

// Email nudges for new messages. Best effort: a failed email never loses the
// message itself, which is already saved.

export async function notifyAdminsOfPlayerMessage(input: {
  threadId: number;
  playerName: string;
  playerEmail: string;
  subject: string;
  body: string;
}): Promise<void> {
  try {
    await sendAdminAlertEmail({
      subject: `Message from ${input.playerName}: ${input.subject}`,
      heading: `${input.playerName} sent a message`,
      lines: [`${input.subject}`, input.body.slice(0, 1500), `From ${input.playerEmail}`],
      cta: { label: "Reply in the inbox", path: `/admin/inbox/${input.threadId}` },
    });
  } catch (err) {
    console.error("[messages] admin email failed:", err);
  }
}

export async function notifyPlayerOfReply(input: {
  to: string;
  lang: string;
  threadId: number;
  subject: string;
  body: string;
}): Promise<void> {
  const vi = input.lang === "vi";
  try {
    await sendPlayerNoticeEmail({
      to: input.to,
      subject: vi ? `Three Wolves đã trả lời: ${input.subject}` : `Three Wolves replied: ${input.subject}`,
      heading: vi ? "Bạn có tin nhắn mới" : "You have a new message",
      lines: [input.body.slice(0, 1500)],
      cta: { label: vi ? "Mở tin nhắn" : "Open the conversation", path: `/profile?thread=${input.threadId}` },
    });
  } catch (err) {
    console.error("[messages] player email failed:", err);
  }
}
