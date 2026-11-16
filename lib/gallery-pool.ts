import { GALLERY_IMAGES } from "./constants";
import { listGalleryPhotos } from "./photos-db";
import type { CmsGalleryImage } from "./sanity-queries";

/**
 * The Gallery's photo pool: the club's curated photos (Sanity, or the
 * bundled defaults) plus every approved player photo, credited. Featured
 * player photos come first so the weekly rotation is more likely to show
 * them.
 */
export async function buildGalleryPool(cms: CmsGalleryImage[] | null): Promise<CmsGalleryImage[]> {
  const club: CmsGalleryImage[] =
    cms && cms.length > 0
      ? cms
      : GALLERY_IMAGES.map((img) => ({ src: img.src, alt: { en: img.alt, vi: img.alt }, downloadUrl: img.src }));
  const players = await listGalleryPhotos();
  const fromPlayers: CmsGalleryImage[] = players.map((p) => ({
    src: p.displayUrl,
    thumb: p.thumbUrl,
    // Vercel Blob serves the original as a download with ?download=1.
    downloadUrl: `${p.originalUrl}${p.originalUrl.includes("?") ? "&" : "?"}download=1`,
    alt: { en: p.caption || `Photo by ${p.credit}`, vi: p.caption || `Ảnh của ${p.credit}` },
    credit: p.credit,
  }));
  const featured = fromPlayers.filter((_, i) => players[i].featured);
  const rest = fromPlayers.filter((_, i) => !players[i].featured);
  return [...featured, ...club, ...rest];
}
