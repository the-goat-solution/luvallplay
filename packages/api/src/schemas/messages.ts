// Messages (the inbox: conversations with the club's admins).
import { z } from "zod";
import { clubParams } from "./clubs.ts";
import { threadSummarySchema } from "./me.ts";

export const threadParams = clubParams.extend({
  id: z.coerce.number().int().positive().max(2_147_483_647),
});

export const threadListItemSchema = threadSummarySchema.extend({
  status: z.enum(["open", "closed"]),
  /** Who wrote last: "player" (them) or "admin" (the club). */
  lastSender: z.enum(["player", "admin"]),
});
export const threadsResponse = z.object({ threads: z.array(threadListItemSchema) });

export const messageSchema = z.object({
  id: z.number().int(),
  sender: z.enum(["player", "admin"]),
  body: z.string(),
  createdAt: z.string(),
});
/** Reading a conversation marks it read. */
export const threadResponse = z.object({
  thread: z.object({
    id: z.number().int(),
    subject: z.string(),
    status: z.enum(["open", "closed"]),
    messages: z.array(messageSchema),
  }),
});

export const newThreadRequest = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});
export const newThreadResponse = z.object({ ok: z.literal(true), id: z.number().int() });

export const replyRequest = z.object({ body: z.string().trim().min(1).max(4000) });
export const replyResponse = z.object({ ok: z.literal(true), message: messageSchema });
