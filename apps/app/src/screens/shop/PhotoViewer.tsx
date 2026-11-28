// The shop's photos full screen (a gap the cutover listed; the website's
// PhotoViewer): swipe or ‹ › between photos, Escape or ✕ to close, pinch to
// zoom. A native modal <dialog> (components/Dialog.tsx), so focus stays in it
// and returns to the photo that opened it.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";

export function PhotoViewer({ images, start, alt, onClose, t }: { images: string[]; start: number; alt: (i: number) => string; onClose: () => void; t: (k: "close" | "shop_prev_photo" | "shop_next_photo") => string }) {
  const [i, setI] = useState(start);
  const strip = useRef<HTMLDivElement>(null);
  const go = (n: number) => {
    const next = (n + images.length) % images.length;
    setI(next);
    strip.current?.scrollTo({ left: next * strip.current.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    strip.current?.scrollTo({ left: start * strip.current.clientWidth });
  }, [start]);
  const many = images.length > 1;
  return (
    <Dialog label={alt(i)} onClose={onClose} className="photo-viewer">
      <div
        ref={strip}
        className="viewer-strip"
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
        }}
        tabIndex={0}
        aria-roledescription="carousel"
      >
        {images.map((src, n) => (
          <div key={src} className="viewer-slide" aria-hidden={n !== i}>
            <img src={src} alt={alt(n)} />
          </div>
        ))}
      </div>
      <button type="button" className="icon-button viewer-close" onClick={onClose} aria-label={t("close")}>✕</button>
      {many && (
        <>
          <button type="button" className="icon-button viewer-nav viewer-prev" onClick={() => go(i - 1)} aria-label={t("shop_prev_photo")}>‹</button>
          <button type="button" className="icon-button viewer-nav viewer-next" onClick={() => go(i + 1)} aria-label={t("shop_next_photo")}>›</button>
          <p className="viewer-count" aria-live="polite">{i + 1} / {images.length}</p>
        </>
      )}
    </Dialog>
  );
}
