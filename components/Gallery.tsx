"use client";

import { GALLERY_IMAGES } from "@/lib/constants";
import { Trans } from "@/components/Trans";
import { useLanguage } from "@/context/LanguageContext";
import { pickLocale } from "@/lib/sanity";
import type { CmsGalleryImage } from "@/lib/sanity-queries";

declare global {
  interface Window {
    openLightbox?: (index: number) => void;
  }
}

export function Gallery({ images }: { images?: CmsGalleryImage[] }) {
  const { lang } = useLanguage();

  const galleryImages =
    images && images.length > 0
      ? images.map((img) => ({
          src: img.src,
          alt: img.alt ? pickLocale(img.alt, lang) : "Gallery photo",
        }))
      : GALLERY_IMAGES.map((img) => ({ src: img.src, alt: img.alt }));

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
              className="gallery-item animate-in"
              style={i > 0 ? { animationDelay: `${i * 0.1}s` } : undefined}
              role="button"
              tabIndex={0}
              onClick={() => window.openLightbox?.(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") window.openLightbox?.(i);
              }}
            >
              <img src={img.src} alt={img.alt} />
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
      </div>
    </section>
  );
}
