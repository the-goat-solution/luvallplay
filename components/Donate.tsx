"use client";

import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";

export function Donate() {
  const { openDonateModal } = useApp();

  return (
    <section className="section section-navy" id="donate" data-screen-label="Donate">
      <div className="container">
        <div style={{ textAlign: "center" }}>
          <div className="section-label section-label-light" style={{ justifyContent: "center" }}>
            <Trans k="donate_lbl" />
          </div>
          <h2 className="section-title section-title-white" style={{ textAlign: "center" }}>
            <Trans k="donate_h" />
          </h2>
        </div>

        <div className="donate-panel animate-in">
          <div className="donate-icon">🏸</div>
          <p className="section-sub section-sub-light" style={{ margin: "0 auto" }}>
            <Trans k="donate_sub" />
          </p>

          <ul className="donate-features">
            <li className="price-feat">
              <div className="price-feat-check">✓</div>
              <span>
                <Trans k="donate_f1" />
              </span>
            </li>
            <li className="price-feat">
              <div className="price-feat-check">✓</div>
              <span>
                <Trans k="donate_f2" />
              </span>
            </li>
            <li className="price-feat">
              <div className="price-feat-check">✓</div>
              <span>
                <Trans k="donate_f3" />
              </span>
            </li>
          </ul>

          <button type="button" className="btn btn-primary" onClick={openDonateModal}>
            <Trans k="donate_cta" />
          </button>
        </div>
      </div>
    </section>
  );
}
