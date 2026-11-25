import { appRoute, fail } from "@/lib/app-api";
import { portalUrl } from "@/lib/app-membership";

// Stripe's page for updating the card on file; it returns to the app.
const route = appRoute("membership.portal", async ({ player, request }) => {
  try {
    return { url: await portalUrl(player, request) };
  } catch (err) {
    console.error("[app-api] portal failed:", err);
    return fail(503, "unavailable");
  }
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
