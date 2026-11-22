import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { About } from "@/components/About";
import { Schedule } from "@/components/Schedule";
import { Gallery } from "@/components/Gallery";
import { AppFeatures } from "@/components/AppFeatures";
import { Membership } from "@/components/Membership";
import { Reviews } from "@/components/Reviews";
import { Donate } from "@/components/Donate";
import { Footer } from "@/components/Footer";
import { ClientShell } from "@/components/ClientShell";
import { SignupPauseProvider } from "@/context/SignupPauseContext";
import { getPausedDays } from "@/lib/day-requests";
import {
  fetchSiteSettings,
  fetchHero,
  fetchAbout,
  fetchGallery,
  fetchScheduleSettings,
  fetchPricingPlans,
} from "@/lib/sanity-queries";
import { buildGalleryPool } from "@/lib/gallery-pool";
import { LeaderboardTeaser } from "@/components/leaderboard/LeaderboardTeaser";
import { teaserBoard } from "@/lib/leaderboard-data";

export const revalidate = 60;

function getCalendarSubscribeLinks(calendarId: string | undefined) {
  if (!calendarId) return undefined;
  return {
    googleUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}`,
    icsUrl: `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`,
  };
}

export default async function HomePage() {
  const [
    siteSettings,
    hero,
    about,
    gallery,
    scheduleSettings,
    pricingPlans,
    pausedDays,
    teaser,
  ] = await Promise.all([
    fetchSiteSettings(),
    fetchHero(),
    fetchAbout(),
    fetchGallery(),
    fetchScheduleSettings(),
    fetchPricingPlans(),
    getPausedDays(),
    // Top five, first names only (the full board is in the app's Arena).
    process.env.POSTGRES_URL ? teaserBoard().catch(() => []) : Promise.resolve([]),
  ]);

  const calendarSubscribe = getCalendarSubscribeLinks(process.env.GOOGLE_CALENDAR_ID);
  // Club photos plus approved player photos (see lib/gallery-pool.ts).
  const galleryPool = await buildGalleryPool(gallery);

  return (
    <SignupPauseProvider pausedDays={pausedDays}>
      <Navigation />
      <Hero
        backgroundImage={hero?.backgroundImageUrl}
        tagline={hero?.tagline}
      />
      <About stats={siteSettings?.stats} cms={about ?? undefined} />
      <Schedule
        scheduleSettings={scheduleSettings ?? undefined}
        calendarSubscribe={calendarSubscribe}
      />
      <Gallery images={galleryPool} />
      <AppFeatures />
      <LeaderboardTeaser rows={teaser} />
      <Membership pricingPlans={pricingPlans ?? undefined} />
      <Reviews googleReviewUrl={siteSettings?.googleReviewUrl} />
      <Donate />
      <Footer />
      <ClientShell
        galleryImages={galleryPool}
        pricingPlans={pricingPlans ?? undefined}
      />
    </SignupPauseProvider>
  );
}
