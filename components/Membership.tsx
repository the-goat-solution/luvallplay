"use client";

import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useLanguage } from "@/context/LanguageContext";
import { Trans } from "@/components/Trans";
import type { PlanId } from "@/lib/constants";
import {
  resolveAllPlanDisplays,
  type CmsPricingPlan,
  type PlanDisplay,
} from "@/lib/pricing-plans";

function PriceCard({
  display,
  delay,
}: {
  display: PlanDisplay;
  delay?: string;
}) {
  const { openCasualModal, openMembershipModal } = useApp();
  const { planId, featured, name, description, priceNzd, period, ctaKey, features } =
    display;

  const onCta = () => {
    if (planId === "casual") openCasualModal();
    else openMembershipModal(planId as PlanId);
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
      <div className="price-type">{name}</div>
      <div className="price-name">{name}</div>
      <p className="price-desc">{description}</p>
      <div className="price-amount-row">
        <span className="price-cur">NZD $</span>
        <span className="price-amt">{priceNzd}</span>
      </div>
      <p className="price-period">{period}</p>
      <ul className="price-features">
        {features.map((feat) => (
          <li key={feat} className="price-feat">
            <div className="price-feat-check">✓</div>
            <span>{feat}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`btn btn-full ${featured ? "btn-primary" : "btn-outline-white"}`}
        onClick={onCta}
      >
        <Trans k={ctaKey} />
      </button>
    </div>
  );
}

export function Membership({
  pricingPlans,
}: {
  pricingPlans?: CmsPricingPlan[] | null;
}) {
  const { lang, tr } = useLanguage();
  const displays = useMemo(
    () => resolveAllPlanDisplays(pricingPlans, lang, tr),
    [pricingPlans, lang, tr],
  );

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
          {displays.map((display, i) => (
            <PriceCard
              key={display.planId}
              display={display}
              delay={i > 0 ? `${i * 0.1}s` : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
