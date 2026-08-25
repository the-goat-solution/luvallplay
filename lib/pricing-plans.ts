import { PRICES, type PlanId } from "@/lib/constants";
import type { I18nKey, Lang } from "@/lib/i18n";
import { pickLocale, type LocaleString, type LocaleText } from "@/lib/sanity";

export type CmsPricingPlan = {
  planId: PlanId;
  name?: LocaleString;
  description?: LocaleText;
  priceNzd?: number;
  periodLabel?: LocaleString;
  featured?: boolean;
  features?: LocaleString[];
  stripePriceId?: string;
};

const PLAN_ORDER: PlanId[] = ["casual", "monthly", "quarterly"];

const I18N_KEYS: Record<
  PlanId,
  {
    name: "p_cas" | "p_mon" | "p_qtr";
    desc: "p_cas_d" | "p_mon_d" | "p_qtr_d";
    per: "p_cas_per" | "p_mon_per" | "p_qtr_per";
    cta: "cta_cas" | "cta_mon" | "cta_qtr";
  }
> = {
  casual: { name: "p_cas", desc: "p_cas_d", per: "p_cas_per", cta: "cta_cas" },
  monthly: { name: "p_mon", desc: "p_mon_d", per: "p_mon_per", cta: "cta_mon" },
  quarterly: {
    name: "p_qtr",
    desc: "p_qtr_d",
    per: "p_qtr_per",
    cta: "cta_qtr",
  },
};

const DEFAULT_FEATURE_KEYS: Record<PlanId, I18nKey[]> = {
  casual: ["f_court", "f_shuttle", "f_racquet"],
  monthly: ["f_court", "f_shuttle", "f_racquet", "f_community", "f_cancel"],
  quarterly: [
    "f_court",
    "f_shuttle",
    "f_racquet",
    "f_community",
    "f_priority",
    "f_save",
  ],
};

export type PlanDisplay = {
  planId: PlanId;
  name: string;
  description: string;
  priceNzd: number;
  period: string;
  featured: boolean;
  ctaKey: (typeof I18N_KEYS)[PlanId]["cta"];
  features: string[];
  modalPriceLabel: string;
};

/** Merge CMS rows with defaults so all three plans always render. */
export function mergePricingPlans(
  cms: CmsPricingPlan[] | null | undefined,
): CmsPricingPlan[] {
  const byId = new Map<PlanId, CmsPricingPlan>();
  for (const row of cms ?? []) {
    if (row.planId && PLAN_ORDER.includes(row.planId)) {
      byId.set(row.planId, row);
    }
  }
  return PLAN_ORDER.map((planId) => ({
    featured: planId === "monthly",
    ...byId.get(planId),
    planId,
  }));
}

export function resolvePlanDisplay(
  plan: CmsPricingPlan,
  lang: Lang,
  tr: (key: I18nKey) => string,
): PlanDisplay {
  const keys = I18N_KEYS[plan.planId];
  const priceNzd = plan.priceNzd ?? PRICES[plan.planId];
  const name = pickLocale(plan.name, lang) || tr(keys.name);
  const description = pickLocale(plan.description, lang) || tr(keys.desc);
  const period = pickLocale(plan.periodLabel, lang) || tr(keys.per);

  const cmsFeatures =
    plan.features?.map((f) => pickLocale(f, lang)).filter(Boolean) ?? [];
  const features =
    cmsFeatures.length > 0
      ? cmsFeatures
      : DEFAULT_FEATURE_KEYS[plan.planId].map((k) => tr(k));

  let modalPriceLabel: string;
  if (plan.planId === "casual") {
    modalPriceLabel = `$${priceNzd}`;
  } else if (plan.planId === "monthly") {
    modalPriceLabel = `$${priceNzd}/4wk`;
  } else {
    modalPriceLabel = `$${priceNzd}/12wk`;
  }

  return {
    planId: plan.planId,
    name,
    description,
    priceNzd,
    period,
    featured: Boolean(plan.featured),
    ctaKey: keys.cta,
    features,
    modalPriceLabel,
  };
}

export function resolveAllPlanDisplays(
  cms: CmsPricingPlan[] | null | undefined,
  lang: Lang,
  tr: (key: I18nKey) => string,
): PlanDisplay[] {
  return mergePricingPlans(cms).map((p) => resolvePlanDisplay(p, lang, tr));
}
