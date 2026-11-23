import { orm, schema } from "../database.ts";

/** Adds someone to the waitlist for a play day (or the general list without a date). */
export async function addToWaitlist(w: { sessionDate: string | null; name: string; email: string }): Promise<void> {
  await orm().insert(schema.waitlist).values({ session_date: w.sessionDate, name: w.name, email: w.email });
}
