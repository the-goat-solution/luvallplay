"use client";

import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import type { Lang } from "@/lib/i18n";

const FB_URL = "https://www.facebook.com/profile.php?id=61575583556969";

export function Navigation() {
  const { lang, setLang } = useLanguage();
  const { openMembershipModal } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const setLanguage = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
  };

  const closeMobile = () => {
    setMobileOpen(false);
    document.body.style.overflow = "";
  };

  const openMobile = () => {
    setMobileOpen(true);
    document.body.style.overflow = "hidden";
  };

  return (
    <>
      <nav className="nav" id="main-nav">
        <div className="container">
          <div className="nav-inner">
            <a href="#hero" className="nav-logo">
              <img
                src="/uploads/Three wolves logo transparent.svg"
                alt="Three Wolves"
                style={{ display: "none" }}
              />
            </a>
            <ul className="nav-links">
              <li>
                <a href="#about">
                  <Trans k="nav_about" />
                </a>
              </li>
              <li>
                <a href="#schedule">
                  <Trans k="nav_schedule" />
                </a>
              </li>
              <li>
                <a href="#gallery">
                  <Trans k="nav_gallery" />
                </a>
              </li>
              <li>
                <a href="#membership">
                  <Trans k="nav_membership" />
                </a>
              </li>
              <li>
                <a href="#reviews">Reviews</a>
              </li>
            </ul>
            <div className="nav-actions">
              <div className="lang-toggle">
                <button
                  type="button"
                  className={`lang-btn${lang === "en" ? " active" : ""}`}
                  onClick={() => setLanguage("en")}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`lang-btn${lang === "vi" ? " active" : ""}`}
                  onClick={() => setLanguage("vi")}
                >
                  VI
                </button>
              </div>
              <a
                href={FB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-fb"
                aria-label="Facebook"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
              <button
                type="button"
                className="nav-cta btn"
                onClick={() => openMembershipModal("monthly")}
              >
                <Trans k="nav_join" />
              </button>
              <button
                type="button"
                className="hamburger"
                id="nav-hamburger"
                aria-label="Open menu"
                onClick={openMobile}
              >
                <span />
                <span />
                <span />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className={`mobile-menu${mobileOpen ? " open" : ""}`} id="mobile-menu">
        <button
          type="button"
          className="mobile-close"
          onClick={closeMobile}
          aria-label="Close menu"
        >
          ×
        </button>
        <a href="#about" onClick={closeMobile}>
          <Trans k="nav_about" />
        </a>
        <a href="#schedule" onClick={closeMobile}>
          <Trans k="nav_schedule" />
        </a>
        <a href="#gallery" onClick={closeMobile}>
          <Trans k="nav_gallery" />
        </a>
        <a href="#membership" onClick={closeMobile}>
          <Trans k="nav_membership" />
        </a>
        <button
          type="button"
          className="mobile-menu-join"
          onClick={() => {
            openMembershipModal("monthly");
            closeMobile();
          }}
        >
          <Trans k="nav_join" />
        </button>
        <div className="lang-toggle" style={{ marginTop: 4 }}>
          <button
            type="button"
            className={`lang-btn${lang === "en" ? " active" : ""}`}
            onClick={() => setLanguage("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={`lang-btn${lang === "vi" ? " active" : ""}`}
            onClick={() => setLanguage("vi")}
          >
            VI
          </button>
        </div>
      </div>
    </>
  );
}
