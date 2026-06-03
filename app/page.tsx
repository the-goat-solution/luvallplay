import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { About } from "@/components/About";
import { Schedule } from "@/components/Schedule";
import { Gallery } from "@/components/Gallery";
import { Membership } from "@/components/Membership";
import { Reviews } from "@/components/Reviews";
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

export default async function HomePage() {
  const [siteSettings, hero, about, gallery, scheduleSettings] = await Promise.all([
    fetchSiteSettings(),
    fetchHero(),
    fetchAbout(),
    fetchGallery(),
    fetchScheduleSettings(),
  ]);

  return (
    <>
      <Navigation />
      <Hero
        backgroundImage={hero?.backgroundImageUrl}
        tagline={hero?.tagline}
      />
      <About stats={siteSettings?.stats} cms={about ?? undefined} />
      <Schedule scheduleSettings={scheduleSettings ?? undefined} />
      <Gallery images={gallery ?? undefined} />
      <Membership />
      <Reviews googleReviewUrl={siteSettings?.googleReviewUrl} />
      <Footer />
      <ClientShell galleryImages={gallery ?? undefined} />
    </>
  );
}
