import { appRoute, fail } from "@/lib/app-api";
import { bookCasual } from "@/lib/app-membership";

// A casual spot on a play day: a payment for the browser to confirm; the webhook books it.
const route = appRoute(
  "play.book",
  async ({ player, body }) => {
    const r = await bookCasual(player, body.date);
    return r.ok ? { clientSecret: r.clientSecret, periodStart: null } : fail(r.status, r.code);
  },
  { rateKey: (ip) => `pi:${ip}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
