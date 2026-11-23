import type { Metadata } from "next";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { Lightbox } from "@/components/Lightbox";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { fetchGallery } from "@/lib/sanity-queries";
import { buildGalleryPool } from "@/lib/gallery-pool";

export const metadata: Metadata = {
  title: "Gallery — Three Wolves Badminton Club",
  description: "Photos from Three Wolves play days, shared by the club and its players.",
};

export const revalidate = 60;

const PER_PAGE = 24;

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: rawPage } = await searchParams;
  const pool = await buildGalleryPool(await fetchGallery());
  const pages = Math.max(1, Math.ceil(pool.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(rawPage) || 1));
  const items = pool.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <>
      <Navigation />
      <GalleryGrid items={items} page={page} pages={pages} total={pool.length} />
      <Footer />
      <Lightbox images={items} />
    </>
  );
}
