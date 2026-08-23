import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { About } from "@/components/About";
import { Schedule } from "@/components/Schedule";
import { Gallery } from "@/components/Gallery";
import { Membership } from "@/components/Membership";
import { Reviews } from "@/components/Reviews";
import { Donate } from "@/components/Donate";
import { Footer } from "@/components/Footer";
import { ClientShell } from "@/components/ClientShell";
import {
  fetchSiteSettings,
  fetchHero,
  fetchAbout,
  fetchGallery,
  fetchScheduleSettings,
} from "@/lib/sanity-queries";

export const revalidate = 60;

function getCalendarSubscribeLinks(calendarId: string | undefined) {
  if (!calendarId) return undefined;
  return {
    googleUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}`,
    icsUrl: `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`,
  };
}

export default async function HomePage() {
  const [siteSettings, hero, about, gallery, scheduleSettings] = await Promise.all([
    fetchSiteSettings(),
    fetchHero(),
    fetchAbout(),
    fetchGallery(),
    fetchScheduleSettings(),
  ]);

  const calendarSubscribe = getCalendarSubscribeLinks(process.env.GOOGLE_CALENDAR_ID);

  return (
    <>
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
      <Gallery images={gallery ?? undefined} />
      <Membership />
      <Reviews googleReviewUrl={siteSettings?.googleReviewUrl} />
      <Donate />
      <Footer />
      <ClientShell galleryImages={gallery ?? undefined} />
    </>
  );
}
