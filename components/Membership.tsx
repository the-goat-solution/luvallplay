"use client";

import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import type { PlanId } from "@/lib/constants";

function PriceCard({
  plan,
  featured,
  delay,
}: {
  plan: "casual" | "monthly" | "quarterly";
  featured?: boolean;
  delay?: string;
}) {
  const { openCasualModal, openMembershipModal } = useApp();

  const amounts = { casual: "10", monthly: "33", quarterly: "85" };
  const ctaKeys = {
    casual: "cta_cas" as const,
    monthly: "cta_mon" as const,
    quarterly: "cta_qtr" as const,
  };
  const nameKeys = {
    casual: "p_cas" as const,
    monthly: "p_mon" as const,
    quarterly: "p_qtr" as const,
  };
  const descKeys = {
    casual: "p_cas_d" as const,
    monthly: "p_mon_d" as const,
    quarterly: "p_qtr_d" as const,
  };
  const perKeys = {
    casual: "p_cas_per" as const,
    monthly: "p_mon_per" as const,
    quarterly: "p_qtr_per" as const,
  };

  const onCta = () => {
    if (plan === "casual") openCasualModal();
    else openMembershipModal(plan as PlanId);
  };

  return (
    <div
      className={`price-card animate-in${featured ? " featured" : ""}`}
      style={delay ? { animationDelay: delay } : undefined}
    >
      {featured && (
        <div className="price-featured-tag">
          <Trans k="p_popular" />
        </div>
      )}
      <div className="price-type">
        <Trans k={nameKeys[plan]} />
      </div>
      <div className="price-name">
        <Trans k={nameKeys[plan]} />
      </div>
      <p className="price-desc">
        <Trans k={descKeys[plan]} />
      </p>
      <div className="price-amount-row">
        <span className="price-cur">NZD $</span>
        <span className="price-amt">{amounts[plan]}</span>
      </div>
      <p className="price-period">
        <Trans k={perKeys[plan]} />
      </p>
      <ul className="price-features">
        <li className="price-feat">
          <div className="price-feat-check">✓</div>
          <span>
            <Trans k="f_court" />
          </span>
        </li>
        <li className="price-feat">
          <div className="price-feat-check">✓</div>
          <span>
            <Trans k="f_shuttle" />
          </span>
        </li>
        <li className="price-feat">
          <div className="price-feat-check">✓</div>
          <span>
            <Trans k="f_racquet" />
          </span>
        </li>
        {(plan === "monthly" || plan === "quarterly") && (
          <>
            <li className="price-feat">
              <div className="price-feat-check">✓</div>
              <span>
                <Trans k="f_community" />
              </span>
            </li>
            {plan === "monthly" && (
              <li className="price-feat">
                <div className="price-feat-check">✓</div>
                <span>
                  <Trans k="f_cancel" />
                </span>
              </li>
            )}
            {plan === "quarterly" && (
              <>
                <li className="price-feat">
                  <div className="price-feat-check">✓</div>
                  <span>
                    <Trans k="f_priority" />
                  </span>
                </li>
                <li className="price-feat">
                  <div className="price-feat-check">✓</div>
                  <span>
                    <Trans k="f_save" />
                  </span>
                </li>
              </>
            )}
          </>
        )}
      </ul>
      <button
        type="button"
        className={`btn btn-full ${featured ? "btn-primary" : "btn-outline-white"}`}
        onClick={onCta}
      >
        <Trans k={ctaKeys[plan]} />
      </button>
    </div>
  );
}

export function Membership() {
  return (
    <section className="section section-navy" id="membership" data-screen-label="Membership">
      <div className="container">
        <div className="section-label section-label-light">
          <Trans k="mem_lbl" />
        </div>
        <h2 className="section-title section-title-white">
          <Trans k="mem_h" />
        </h2>
        <p className="section-sub section-sub-light">
          <Trans k="mem_sub" />
        </p>

        <div className="pricing-grid">
          <PriceCard plan="casual" />
          <PriceCard plan="monthly" featured delay=".1s" />
          <PriceCard plan="quarterly" delay=".2s" />
        </div>
      </div>
    </section>
  );
}
