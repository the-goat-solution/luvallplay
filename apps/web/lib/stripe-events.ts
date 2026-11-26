// Stripe events that were handled to the end (audit H3).
//
// Stripe delivers an event at least once: again after a timeout, and again
// by hand from its dashboard. Each handler in the webhook is written to be
// safe to repeat; this is the second line of defence for all of them at
// once: an event id that was handled to the end is skipped.
//
// The id is recorded AFTER the handlers finish, never before: if a handler
// fails, Stripe's retry must still do the work. Two deliveries at the same
// moment can therefore both run, which the handlers' own guards cover.
//
// The table comes with migration 0014. Until it has run, nothing is
// remembered and every event is handled as before.
import { sql } from "./database";

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const missingTable = (err: unknown) => (err as { code?: string } | null)?.code === "42P01";

/** Was this event already handled to the end? False when it can't be known. */
export async function stripeEventHandled(eventId: string, db: Db = sql): Promise<boolean> {
  try {
    const { rows } = await db.query(`SELECT 1 FROM stripe_events WHERE event_id = $1;`, [eventId]);
    return rows.length > 0;
  } catch (err) {
    if (!missingTable(err)) console.warn("[stripe-events] can't read handled events, handling this one:", String((err as Error)?.message ?? err).slice(0, 200));
    return false;
  }
}

/** Remember an event once its handlers have finished. Never throws: the work is done either way. */
export async function markStripeEventHandled(eventId: string, type: string, db: Db = sql): Promise<void> {
  try {
    await db.query(`INSERT INTO stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING;`, [eventId, type]);
    // Stripe retries for up to three days; a year of ids is plenty and stays small.
    if (Math.random() < 0.01) await db.query(`DELETE FROM stripe_events WHERE processed_at < NOW() - INTERVAL '1 year';`);
  } catch (err) {
    if (!missingTable(err)) console.warn("[stripe-events] can't record a handled event:", String((err as Error)?.message ?? err).slice(0, 200));
  }
}
