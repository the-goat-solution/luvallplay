// Player: your play stats (the website's Player tab).
import { z } from "zod";

const byPeriod = <T extends z.ZodTypeAny>(v: T) => z.object({ month: v, quarter: v, year: v, lifetime: v });
export const playerStatsResponse = z.object({
  attended: byPeriod(z.number().int()),
  /** Your place on the play-days and round-robin boards per period (null: not ranked, or hidden). */
  ranks: byPeriod(z.object({ attendance: z.number().int().nullable(), rr: z.number().int().nullable() })),
  /** Weeks in a row with a play day. */
  streak: z.object({ current: z.number().int(), best: z.number().int() }),
  rr: z.object({ days: z.number().int(), points: z.number(), wins: z.number().int(), losses: z.number().int(), bestPlacing: z.number().int().nullable() }),
  /** Play days attended, newest first. */
  attendedDates: z.array(z.string()),
  /** Play days the club ran in the last 26 weeks. */
  clubDates: z.array(z.string()),
  rrHistory: z.array(z.object({
    date: z.string(), points: z.number(), wins: z.number().int(), losses: z.number().int(),
    placing: z.number().int(), teams: z.number().int(), diff: z.number(),
  })),
});
