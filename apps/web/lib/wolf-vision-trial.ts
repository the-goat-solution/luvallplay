// Wolf Vision free trial: free for everyone until the end of February 2027
// (New Zealand time, NZDT = UTC+13), then the paywall (NZ$5 a live match,
// NZ$2 a video) goes up. Shared by the server (pass API) and the app (banners).

/** First moment of the paid period: 1 March 2027, 00:00 in New Zealand. */
export const WV_TRIAL_ENDS_ISO = "2027-03-01T00:00:00+13:00";
const ENDS = Date.parse(WV_TRIAL_ENDS_ISO);

export function isTrial(now: number = Date.now()): boolean {
  return now < ENDS;
}

/** Whole days left in the trial (counting today), 0 once it is over. */
export function trialDaysLeft(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((ENDS - now) / 86_400_000));
}
