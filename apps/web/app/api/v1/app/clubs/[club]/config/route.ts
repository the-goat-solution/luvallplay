import { currencyExponent } from "@luvallplay/core/money";
import { resolveClubTheme } from "@luvallplay/ui";
import { apiBaseForRegion, appRoute } from "@/lib/app-api";
import { enabledModules } from "@/lib/club-modules";
import { sql } from "@/lib/database";
import { getSiteUrl } from "@/lib/email-layout";
import { getClubPresentation } from "@/lib/repos/clubs";

// What the app needs to dress itself as this club and to know what the club
// has switched on. Public, so an invite link can apply the club's look
// before sign-in; nothing in it is private.
const route = appRoute("clubs.config", async ({ club, request }) => {
  const stored = await getClubPresentation(club.slug).catch((err) => {
    console.error("[app-api] could not read the club's theme:", err);
    return null;
  });
  const theme = resolveClubTheme(stored?.theme, club.slug);
  const modules = [...(await enabledModules(sql))].sort();
  const mode = stored?.paymentMode;
  return {
    club: {
      slug: club.slug,
      name: club.name,
      country: club.country,
      region: club.region,
      timezone: club.timezone,
      currency: club.currency,
      currencyExponent: currencyExponent(club.currency),
      languages: club.languages,
      paymentMode: mode === "offline" || mode === "online" ? mode : ("free" as const),
      sports: stored?.sports ?? [],
      webUrl: getSiteUrl(),
    },
    apiBase: apiBaseForRegion(club.region, request) ?? `${new URL(request.url).origin}/api/v1/app`,
    modules,
    // A logo stored as a path lives on the club's web host.
    theme: { ...theme, logoUrl: theme.logoUrl?.startsWith("/") ? `${getSiteUrl()}${theme.logoUrl}` : theme.logoUrl },
    terms: club.terms,
    settings: {
      playDays: { bookingWindowDays: club.playDays.bookingWindowDays, bookingCutoffHour: club.playDays.bookingCutoffHour },
      memberships: { days: club.memberships.days },
      donations: club.donations,
    },
  };
});

export const GET = route.handle;
export const OPTIONS = route.preflight;
