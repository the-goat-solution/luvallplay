"use client";

import { useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useLanguage } from "@/context/LanguageContext";
import { Trans } from "@/components/Trans";
import { pickLocale, type LocaleText } from "@/lib/sanity";

const DEFAULT_HERO_IMG =
  "/uploads/705237516_122111863220852785_3866235625892853843_n.jpg";

export function Hero({
  backgroundImage,
  tagline,
}: {
  backgroundImage?: string;
  tagline?: LocaleText;
}) {
  const { openMembershipModal, openCasualModal } = useApp();
  const { lang } = useLanguage();

  const heroImg = backgroundImage || DEFAULT_HERO_IMG;
  const taglineText = tagline ? pickLocale(tagline, lang) : "";

  useEffect(() => {
    const bg = document.getElementById("hero-bg");
    if (!bg) return;
    const img = new Image();
    img.onload = () => bg.classList.add("loaded");
    img.src = heroImg;
  }, [heroImg]);

  return (
    <section className="hero" id="hero" data-screen-label="Hero">
      <div
        className="hero-bg"
        id="hero-bg"
        style={{ backgroundImage: `url('${heroImg}')` }}
      />
      <div className="hero-overlay" />
      <div className="hero-content">
        <img
          src="/uploads/Three wolves logo transparent.svg"
          className="hero-logo"
          alt="Three Wolves Badminton Club"
        />
        <div className="hero-eyebrow">
          <Trans k="hero_eyebrow" />
        </div>
        <h1 className="hero-title">Three Wolves</h1>
        <p className="hero-subtitle">
          <Trans k="hero_sub" />
        </p>
        <p className="hero-tagline">
          {taglineText || <Trans k="hero_tagline" />}
        </p>
        <div className="hero-meta">
          <div className="hero-meta-item">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <Trans k="hero_day" />
          </div>
          <div className="hero-meta-item">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <Trans k="hero_venue" />
          </div>
        </div>
        <div className="hero-ctas">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openMembershipModal("monthly")}
          >
            <Trans k="hero_cta1" />
          </button>
          <button
            type="button"
            className="btn btn-outline-white"
            onClick={openCasualModal}
          >
            <Trans k="hero_cta2" />
          </button>
        </div>
      </div>
      <div className="hero-scroll">
        <div className="hero-scroll-line" />
      </div>
    </section>
  );
}
