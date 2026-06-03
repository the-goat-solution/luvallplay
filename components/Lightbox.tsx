"use client";

import { useCallback, useEffect, useState } from "react";
import { GALLERY_IMAGES } from "@/lib/constants";

export function Lightbox() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

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
      if (!open) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft")
        setIndex((i) => (i - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length);
      if (e.key === "ArrowRight")
        setIndex((i) => (i + 1) % GALLERY_IMAGES.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const img = GALLERY_IMAGES[index];

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
          onClick={() =>
            update((index - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length)
          }
        >
          &#8249;
        </button>
        <div className="lb-img-wrap">
          <img src={img.src} alt={img.alt} style={{ display: "block" }} />
        </div>
        <button
          type="button"
          className="lb-arrow"
          onClick={() => update((index + 1) % GALLERY_IMAGES.length)}
        >
          &#8250;
        </button>
      </div>
      <div className="lb-thumbs">
        {GALLERY_IMAGES.map((g, i) => (
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
