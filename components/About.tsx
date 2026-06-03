"use client";

import { Trans } from "@/components/Trans";

export function About({
  stats,
}: {
  stats?: {
    sessionsPerYear?: string;
    activeMembers?: string;
    established?: string;
  };
}) {
  const s1 = stats?.sessionsPerYear ?? "52+";
  const s2 = stats?.activeMembers ?? "30+";
  const s3 = stats?.established ?? "2024";
  return (
    <section className="section" id="about" data-screen-label="About">
      <div className="container">
        <div className="about-grid">
          <div className="animate-in">
            <div className="section-label">
              <Trans k="about_lbl" />
            </div>
            <h2 className="section-title">
              <Trans k="about_h" />
            </h2>
            <p className="about-established">
              <Trans k="about_est" />
            </p>
            <p className="about-body">
              <Trans k="about_p1" />
            </p>
            <p className="about-body">
              <Trans k="about_p2" />
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
              src="/uploads/678602054_122107704008852785_8338718090885557850_n.jpg"
              alt="Player in action"
              className="about-img-main"
            />
            <img
              src="/uploads/656703917_122095036622852785_1698823098359580880_n.jpg"
              alt="Club members on court"
              className="about-img-sec"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
