import { appRoute, fail } from "@/lib/app-api";
import { billingFor } from "@/lib/app-membership";

// Card on file, next charge, a scheduled change and receipts (from Stripe; loaded after the screen).
const route = appRoute("membership.billing", async ({ player }) => {
  try {
    return await billingFor(player);
  } catch (err) {
    console.error("[app-api] billing failed:", err);
    return fail(503, "unavailable");
  }
});

export const GET = route.handle;
export const OPTIONS = route.preflight;
