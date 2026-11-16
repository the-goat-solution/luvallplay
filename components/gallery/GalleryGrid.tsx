"use client";

import { useLanguage } from "@/context/LanguageContext";
import { pickLocale } from "@/lib/sanity";
import type { CmsGalleryImage } from "@/lib/sanity-queries";
import s from "./gallery.module.css";

export function GalleryGrid({ items, page, pages, total }: { items: CmsGalleryImage[]; page: number; pages: number; total: number }) {
  const { lang, tr } = useLanguage();
  return (
    <main className={s.page}>
      <header className={s.hero}>
        <div className="section-label" style={{ color: "var(--bronze-light)" }}>
          {tr("gal_lbl")}
        </div>
        <h1 className={s.title}>{tr("gal_h")}</h1>
        <p className={s.sub}>
          {lang === "vi" ? `${total} ảnh từ CLB và các thành viên.` : `${total} photos from the club and its players.`}
        </p>
      </header>
      <div className={s.grid}>
        {items.map((img, i) => (
          <button key={img.src} type="button" className={s.tile} onClick={() => window.openLightbox?.(i)}>
            <img src={img.thumb ?? img.src} alt={img.alt ? pickLocale(img.alt, lang) : "Gallery photo"} loading={i < 4 ? "eager" : "lazy"} decoding="async" />
            {img.credit && <span className={s.credit}>📷 {img.credit}</span>}
          </button>
        ))}
      </div>
      {pages > 1 && (
        <nav className={s.pager} aria-label="Pages">
          {page > 1 ? <a href={`/gallery?page=${page - 1}`}>‹</a> : <span />}
          <span>
            {page} / {pages}
          </span>
          {page < pages ? <a href={`/gallery?page=${page + 1}`}>›</a> : <span />}
        </nav>
      )}
    </main>
  );
}
