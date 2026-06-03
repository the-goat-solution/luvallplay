"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GALLERY_IMAGES } from "@/lib/constants";
import { useLanguage } from "@/context/LanguageContext";
import { pickLocale } from "@/lib/sanity";
import type { CmsGalleryImage } from "@/lib/sanity-queries";

export function Lightbox({ images }: { images?: CmsGalleryImage[] }) {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const galleryImages = useMemo(() => {
    if (images && images.length > 0) {
      return images.map((img) => ({
        src: img.src,
        alt: img.alt ? pickLocale(img.alt, lang) : "Gallery photo",
      }));
    }
    return GALLERY_IMAGES.map((img) => ({ src: img.src, alt: img.alt }));
  }, [images, lang]);

  const count = galleryImages.length;

  const update = useCallback((i: number) => {
    setIndex(i);
  }, []);

  const openAt = useCallback((i: number) => {
    setIndex(i);
    setOpen(true);
    document.body.style.overflow = "hidden";
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    document.body.style.overflow = "";
  }, []);

  useEffect(() => {
    window.openLightbox = openAt;
    return () => {
      delete window.openLightbox;
    };
  }, [openAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open || count === 0) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft")
        setIndex((i) => (i - 1 + count) % count);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, count]);

  if (!open || count === 0) return null;

  const img = galleryImages[index];

  return (
    <div
      className="lightbox open"
      id="lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <button type="button" className="lightbox-close" onClick={close} aria-label="Close">
        ×
      </button>
      <div className="lb-carousel">
        <button
          type="button"
          className="lb-arrow"
          onClick={() => update((index - 1 + count) % count)}
        >
          &#8249;
        </button>
        <div className="lb-img-wrap">
          <img src={img.src} alt={img.alt} style={{ display: "block" }} />
        </div>
        <button
          type="button"
          className="lb-arrow"
          onClick={() => update((index + 1) % count)}
        >
          &#8250;
        </button>
      </div>
      <div className="lb-thumbs">
        {galleryImages.map((g, i) => (
          <img
            key={g.src}
            src={g.src}
            alt={g.alt}
            className={`lb-thumb${i === index ? " active" : ""}`}
            onClick={() => update(i)}
          />
        ))}
      </div>
    </div>
  );
}
