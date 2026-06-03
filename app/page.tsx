import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { About } from "@/components/About";
import { Schedule } from "@/components/Schedule";
import { Gallery } from "@/components/Gallery";
import { Membership } from "@/components/Membership";
import { Reviews } from "@/components/Reviews";
import { Footer } from "@/components/Footer";
import { ClientShell } from "@/components/ClientShell";
import { fetchSiteSettings } from "@/lib/sanity-queries";

export default async function HomePage() {
  const siteSettings = await fetchSiteSettings();

  return (
    <>
      <Navigation />
      <Hero />
      <About stats={siteSettings?.stats} />
      <Schedule />
      <Gallery />
      <Membership />
      <Reviews googleReviewUrl={siteSettings?.googleReviewUrl} />
      <Footer />
      <ClientShell />
    </>
  );
}
