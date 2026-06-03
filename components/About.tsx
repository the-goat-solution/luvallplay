"use client";

import { Trans } from "@/components/Trans";
import { useLanguage } from "@/context/LanguageContext";
import { pickLocale } from "@/lib/sanity";
import type { CmsAbout } from "@/lib/sanity-queries";

const DEFAULT_IMG_MAIN =
  "/uploads/678602054_122107704008852785_8338718090885557850_n.jpg";
const DEFAULT_IMG_SEC =
  "/uploads/656703917_122095036622852785_1698823098359580880_n.jpg";

export function About({
  stats,
  cms,
}: {
  stats?: {
    sessionsPerYear?: string;
    activeMembers?: string;
    established?: string;
  };
  cms?: CmsAbout;
}) {
  const { lang } = useLanguage();

  const s1 = stats?.sessionsPerYear ?? "52+";
  const s2 = stats?.activeMembers ?? "30+";
  const s3 = stats?.established ?? "2024";

  const title = cms?.title ? pickLocale(cms.title, lang) : "";
  const body1 = cms?.body1 ? pickLocale(cms.body1, lang) : "";
  const body2 = cms?.body2 ? pickLocale(cms.body2, lang) : "";
  const imgMain = cms?.imageMainUrl || DEFAULT_IMG_MAIN;
  const imgSec = cms?.imageSecondaryUrl || DEFAULT_IMG_SEC;

  return (
    <section className="section" id="about" data-screen-label="About">
      <div className="container">
        <div className="about-grid">
          <div className="animate-in">
            <div className="section-label">
              <Trans k="about_lbl" />
            </div>
            <h2 className="section-title">
              {title || <Trans k="about_h" />}
            </h2>
            <p className="about-established">
              <Trans k="about_est" />
            </p>
            <p className="about-body">
              {body1 || <Trans k="about_p1" />}
            </p>
            <p className="about-body">
              {body2 || <Trans k="about_p2" />}
            </p>
            <div className="about-stats">
              <div>
                <div className="about-stat-val">{s1}</div>
                <div className="about-stat-lbl">
                  <Trans k="about_s1" />
                </div>
              </div>
              <div>
                <div className="about-stat-val">{s2}</div>
                <div className="about-stat-lbl">
                  <Trans k="about_s2" />
                </div>
              </div>
              <div>
                <div className="about-stat-val">{s3}</div>
                <div className="about-stat-lbl">
                  <Trans k="about_s3" />
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-navy"
              style={{ marginTop: 36 }}
              onClick={() => {
                const el = document.getElementById("gallery");
                if (el) {
                  const top = el.getBoundingClientRect().top + window.scrollY - 80;
                  window.scrollTo({ top, behavior: "smooth" });
                }
              }}
            >
              <Trans k="about_cta" />
            </button>
          </div>
          <div className="about-imgs animate-in" style={{ animationDelay: ".15s" }}>
            <img
              src={imgMain}
              alt="Player in action"
              className="about-img-main"
            />
            <img
              src={imgSec}
              alt="Club members on court"
              className="about-img-sec"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
