"use client";

import { Trans } from "@/components/Trans";

const REVIEWS = [
  {
    initial: "L",
    color: "var(--navy)",
    text: '"A fantastic club with the most welcoming community. I started as a complete beginner and within weeks felt right at home. The Friday sessions are the highlight of my week."',
    name: "Linh T.",
    meta: "Quarterly Member · Google Review",
  },
  {
    initial: "M",
    color: "var(--bronze)",
    text: '"Wonderful atmosphere and great organisation. The level of play ranges from casual to competitive, so there is always a good match for everyone. Highly recommended!"',
    name: "Michael C.",
    meta: "Monthly Member · Google Review",
  },
  {
    initial: "T",
    color: "var(--navy-mid)",
    text: '"Best badminton group in Christchurch! The venue at Graham Condon is excellent and the sessions are very well run. Love being part of the Three Wolves family."',
    name: "Thanh N.",
    meta: "Quarterly Member · Google Review",
  },
];

export function Reviews({
  googleReviewUrl: cmsUrl,
}: {
  googleReviewUrl?: string;
}) {
  const googleReviewUrl =
    cmsUrl || process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || "#";

  return (
    <section className="section" id="reviews" data-screen-label="Reviews">
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 0 }}>
          <div className="section-label" style={{ justifyContent: "center" }}>
            <Trans k="rev_lbl" />
          </div>
          <h2 className="section-title" style={{ textAlign: "center" }}>
            <Trans k="rev_h" />
          </h2>
        </div>
        <div className="reviews-grid">
          {REVIEWS.map((r, i) => (
            <div
              key={r.name}
              className="review-card animate-in"
              style={i > 0 ? { animationDelay: `${i * 0.1}s` } : undefined}
            >
              <div className="review-stars">★★★★★</div>
              <p className="review-text">{r.text}</p>
              <div className="review-author">
                <div className="review-avatar" style={{ background: r.color }}>
                  {r.initial}
                </div>
                <div>
                  <div className="review-name">{r.name}</div>
                  <div className="review-meta">{r.meta}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="reviews-cta">
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-bronze-outline"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <Trans k="rev_cta" />
          </a>
        </div>
      </div>
    </section>
  );
}
