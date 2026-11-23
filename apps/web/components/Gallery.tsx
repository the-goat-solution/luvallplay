"use client";

import { useMemo } from "react";
import { GALLERY_IMAGES } from "@/lib/constants";
import { Trans } from "@/components/Trans";
import { useLanguage } from "@/context/LanguageContext";
import { selectWeeklyRotation } from "@/lib/gallery-rotation";
import { pickLocale } from "@/lib/sanity";
import type { CmsGalleryImage } from "@/lib/sanity-queries";

declare global {
  interface Window {
    openLightbox?: (index: number) => void;
  }
}

// Bento/masonry tile shapes by position, for up to 10 displayed photos —
// fixed spans rather than each photo's own aspect ratio, so the layout stays
// a consistent, deliberate shape no matter what admins upload. Any photos
// beyond 10 are still reachable via the Lightbox carousel (see Lightbox.tsx,
// which reads the full `images` list independently of what's rendered here).
const GALLERY_DISPLAY_LIMIT = 10;
const GALLERY_SHAPES = [
  "gi-big",
  "",
  "gi-wide",
  "gi-tall",
  "",
  "gi-wide",
  "",
  "",
  "",
  "",
];

export function Gallery({ images }: { images?: CmsGalleryImage[] }) {
  const { lang } = useLanguage();

  // fullIndex tracks each photo's position in the complete list (not the
  // rotated subset below) so a click opens the Lightbox — which carousels
  // through every photo, unrotated — at the actual matching photo.
  const fullGalleryImages = useMemo(() => {
    const full =
      images && images.length > 0
        ? images.map((img) => ({
            src: img.src,
            alt: img.alt ? pickLocale(img.alt, lang) : "Gallery photo",
            credit: img.credit,
          }))
        : GALLERY_IMAGES.map((img) => ({ src: img.src, alt: img.alt, credit: undefined as string | undefined }));
    return full.map((img, fullIndex) => ({ ...img, fullIndex }));
  }, [images, lang]);

  // Deterministic weekly rotation (see lib/gallery-rotation.ts) — the same
  // shuffled subset shows to everyone until it rolls over next Wednesday,
  // rather than reshuffling on every page load.
  const galleryImages = useMemo(
    () => selectWeeklyRotation(fullGalleryImages, GALLERY_DISPLAY_LIMIT),
    [fullGalleryImages],
  );

  return (
    <section className="section" id="gallery" data-screen-label="Gallery">
      <div className="container">
        <div className="section-label">
          <Trans k="gal_lbl" />
        </div>
        <h2 className="section-title">
          <Trans k="gal_h" />
        </h2>
        <p className="section-sub">
          <Trans k="gal_sub" />
        </p>

        <div className="gallery-grid">
          {galleryImages.map((img, i) => (
            <div
              key={img.src}
              className={`gallery-item animate-in${GALLERY_SHAPES[i] ? ` ${GALLERY_SHAPES[i]}` : ""}`}
              style={i > 0 ? { animationDelay: `${i * 0.1}s` } : undefined}
              role="button"
              tabIndex={0}
              onClick={() => window.openLightbox?.(img.fullIndex)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  window.openLightbox?.(img.fullIndex);
              }}
            >
              <img src={img.src} alt={img.alt} loading={i < 2 ? "eager" : "lazy"} decoding="async" />
              {img.credit && <span className="gallery-credit">📷 {img.credit}</span>}
              <div className="gallery-overlay">
                <span className="gallery-zoom">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <Trans k="gal_view" />
                </span>
              </div>
            </div>
          ))}
        </div>
        {fullGalleryImages.length > GALLERY_DISPLAY_LIMIT && (
          <p style={{ textAlign: "center", marginTop: 28 }}>
            <a href="/gallery" className="btn btn-bronze-outline">
              {lang === "vi" ? "Xem tất cả ảnh" : "See all photos"} →
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
