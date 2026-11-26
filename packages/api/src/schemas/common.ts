// Shapes every module of the players' app API shares.
import { z } from "zod";

export const langSchema = z.enum(["en", "vi"]);

/** Every error answer: a stable code the app switches on, and sometimes a sentence for logs. */
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof errorSchema>;

/** The answer when there's nothing to say but "done". */
export const okResponse = z.object({ ok: z.literal(true) });
/** The body of a POST that takes no fields. */
export const emptyRequest = z.object({});
