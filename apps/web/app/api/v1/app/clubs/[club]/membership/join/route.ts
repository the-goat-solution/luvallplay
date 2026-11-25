import { appRoute, fail } from "@/lib/app-api";
import { joinMembership } from "@/lib/app-membership";

// Joining: capacity is reserved first, then a payment (or a subscription's
// first invoice) for the browser to confirm. The webhook activates it.
const route = appRoute(
  "membership.join",
  async ({ player, body }) => {
    const r = await joinMembership(player, body);
    return r.ok ? { clientSecret: r.clientSecret, periodStart: r.periodStart } : fail(r.status, r.code);
  },
  { rateKey: (ip) => `sub:${ip}` },
);

export const POST = route.handle;
export const OPTIONS = route.preflight;
