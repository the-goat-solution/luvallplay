"use client";

import { useLanguage } from "@/context/LanguageContext";
import { Trans } from "@/components/Trans";
import type { Lang } from "@/lib/i18n";

const FB_URL = "https://www.facebook.com/profile.php?id=61575583556969";

export function Footer() {
  const { lang, setLang } = useLanguage();

  const setLanguage = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
  };

  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand-col">
            <img
              src="/uploads/Three wolves logo transparent.svg"
              alt="Three Wolves Badminton Club"
              className="footer-logo"
            />
            <p className="footer-tagline">
              <Trans k="footer_tagline" />
            </p>
            <div className="footer-social">
              <a
                href={FB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <div className="footer-heading">
              <Trans k="footer_quick" />
            </div>
            <ul className="footer-links">
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
              <li>
                <a href="#donate">
                  <Trans k="nav_donate" />
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="footer-heading">
              <Trans k="footer_contact" />
            </div>
            <div className="footer-contact-row">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12.4 19.79 19.79 0 0 1 1.61 3.77 2 2 0 0 1 3.6 1.6h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.18a16 16 0 0 0 6 6l.95-1.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 15.5z" />
              </svg>
              <span>(+64) 27 244 4098</span>
            </div>
            <div className="footer-contact-row">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <a href="mailto:threewolvesbadminton@gmail.com">threewolvesbadminton@gmail.com</a>
            </div>
            <div className="footer-contact-row">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>
                Graham Condon Recreation Centre
                <br />
                3 Sisson Drive, Papanui
                <br />
                Christchurch 8053, NZ
              </span>
            </div>
          </div>

          <div>
            <div className="footer-heading">
              <Trans k="footer_follow" />
            </div>
            <ul className="footer-links">
              <li>
                <a
                  href={FB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                  Facebook
                </a>
              </li>
            </ul>
            <div style={{ marginTop: 28 }}>
              <div className="footer-heading">
                <Trans k="footer_lang" />
              </div>
              <div className="footer-lang-switch">
                <button
                  type="button"
                  className={`footer-lang-btn${lang === "en" ? " active" : ""}`}
                  onClick={() => setLanguage("en")}
                >
                  English
                </button>
                <span className="footer-lang-sep">·</span>
                <button
                  type="button"
                  className={`footer-lang-btn${lang === "vi" ? " active" : ""}`}
                  onClick={() => setLanguage("vi")}
                >
                  Tiếng Việt
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copy">
            <Trans k="footer_copy" />
          </p>
          <p className="footer-copy">Secured by Stripe · Christchurch, NZ</p>
        </div>
      </div>
    </footer>
  );
}
