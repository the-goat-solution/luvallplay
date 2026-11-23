import { getAvailableSpots, getUnnotifiedWaitlistForDate, markWaitlistNotified } from "./db";
import { sendWaitlistSpotOpenEmail } from "./email";

// Call this whenever an admin action can free up casual capacity for a play
// day (removing a booking, raising the courts/capacity). Notifies up to as
// many waitlisted people as there are open spots, oldest signup first, and
// only marks a row notified once its email actually sends — a failed send
// is retried on the next capacity-increasing trigger rather than lost.
export async function notifyWaitlistIfSpotOpened(date: string): Promise<number> {
  const spots = await getAvailableSpots(date);
  if (spots <= 0) return 0;

  const candidates = await getUnnotifiedWaitlistForDate(date, spots);
  if (candidates.length === 0) return 0;

  const notifiedIds: number[] = [];
  for (const entry of candidates) {
    try {
      await sendWaitlistSpotOpenEmail(entry.email, entry.name, date);
      notifiedIds.push(entry.id);
    } catch (err) {
      console.error("Failed to send waitlist spot-open email", entry.id, err);
    }
  }

  await markWaitlistNotified(notifiedIds);
  return notifiedIds.length;
}
