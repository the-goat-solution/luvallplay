"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GALLERY_IMAGES } from "@/lib/constants";
import { useLanguage } from "@/context/LanguageContext";
import { pickLocale } from "@/lib/sanity";
import type { CmsGalleryImage } from "@/lib/sanity-queries";

type LightboxImage = {
  src: string;
  alt: string;
  thumb: string;
  downloadUrl: string;
  credit?: string;
};

/** File name offered for a same-origin download (cross-origin URLs name themselves). */
function downloadName(url: string): string {
  const path = url.split("?")[0];
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || "three-wolves-photo.jpg";
}

export function Lightbox({ images }: { images?: CmsGalleryImage[] }) {
  const { lang, tr } = useLanguage();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const galleryImages = useMemo<LightboxImage[]>(() => {
    if (images && images.length > 0) {
      return images.map((img) => ({
        src: img.src,
        alt: img.alt ? pickLocale(img.alt, lang) : "Gallery photo",
        thumb: img.thumb ?? img.src,
        downloadUrl: img.downloadUrl ?? img.src,
        credit: img.credit,
      }));
    }
    return GALLERY_IMAGES.map((img) => ({
      src: img.src,
      alt: img.alt,
      thumb: img.src,
      downloadUrl: img.src,
    }));
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
  const sameOrigin = img.downloadUrl.startsWith("/");

  return (
    <div
      className="lightbox open"
      id="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={img.alt}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="lb-toolbar">
        <a
          className="lb-download"
          href={img.downloadUrl}
          // Same-origin files download via the attribute; Sanity and Blob
          // URLs carry their own "attachment" header instead.
          download={sameOrigin ? downloadName(img.downloadUrl) : undefined}
          rel="noopener"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{tr("gal_download")}</span>
        </a>
        <button type="button" className="lightbox-close" onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      <div className="lb-carousel">
        <button
          type="button"
          className="lb-arrow"
          aria-label="Previous photo"
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
          aria-label="Next photo"
          onClick={() => update((index + 1) % count)}
        >
          &#8250;
        </button>
      </div>
      {img.credit && (
        <p className="lb-credit">{tr("gal_photo_by", { name: img.credit })}</p>
      )}
      <div className="lb-thumbs">
        {galleryImages.map((g, i) => (
          <img
            key={g.src}
            src={g.thumb}
            alt={g.alt}
            loading="lazy"
            decoding="async"
            className={`lb-thumb${i === index ? " active" : ""}`}
            onClick={() => update(i)}
          />
        ))}
      </div>
    </div>
  );
}
