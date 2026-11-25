import { appRoute, fail } from "@/lib/app-api";
import { clubClock } from "@/lib/club";
import { getClubToday } from "@/lib/dates";
import { getCurrentMembership } from "@/lib/membership-self-service";
import { setAbsence } from "@/lib/stats-db";
import { notifyWaitlistIfSpotOpened } from "@/lib/waitlist-notify";

// "Can't make it": the web's /api/profile/absence. A member gives up one play
// day; the spot opens for a casual player and the waitlist hears about it.
// Their attendance streak isn't broken.
const route = appRoute("me.absence", async ({ body, player }) => {
  if (body.date < getClubToday(new Date(), await clubClock()).dateKey) return fail(400, "past");
  if (!(await getCurrentMembership(player.email))) return fail(404, "no_membership");
  await setAbsence(body.date, player.email, body.absent);
  if (body.absent) await notifyWaitlistIfSpotOpened(body.date).catch(() => 0);
  return { ok: true as const };
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
