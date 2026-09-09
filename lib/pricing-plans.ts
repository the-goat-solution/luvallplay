import {
  PRICES,
  type MembershipDay,
  type MembershipTier,
  type PlanId,
} from "@/lib/constants";
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

// Grouped Friday-then-Wednesday so a straight render of this order already
// reads as two day-grouped rows (plus casual standalone) in the UI.
const PLAN_ORDER: PlanId[] = [
  "casual",
  "fridayMonthly",
  "fridayQuarterly",
  "wednesdayMonthly",
  "wednesdayQuarterly",
];

const COMBINED_IDS: Record<MembershipDay, Record<MembershipTier, PlanId>> = {
  friday: { monthly: "fridayMonthly", quarterly: "fridayQuarterly" },
  wednesday: { monthly: "wednesdayMonthly", quarterly: "wednesdayQuarterly" },
};

/** The internal { tier, day } pair a combined plan id represents, or null for casual. */
export function splitPlanId(
  id: PlanId,
): { tier: MembershipTier; day: MembershipDay } | null {
  switch (id) {
    case "fridayMonthly":
      return { tier: "monthly", day: "friday" };
    case "fridayQuarterly":
      return { tier: "quarterly", day: "friday" };
    case "wednesdayMonthly":
      return { tier: "monthly", day: "wednesday" };
    case "wednesdayQuarterly":
      return { tier: "quarterly", day: "wednesday" };
    default:
      return null;
  }
}

/** The combined plan id for a given day + tier — the inverse of splitPlanId. */
export function combinePlanId(day: MembershipDay, tier: MembershipTier): PlanId {
  return COMBINED_IDS[day][tier];
}

/** True for any recurring membership plan id (i.e. everything but casual). */
export function isMembershipPlan(id: PlanId): boolean {
  return splitPlanId(id) !== null;
}

const I18N_KEYS: Record<
  PlanId,
  {
    name: I18nKey;
    desc: I18nKey;
    per: I18nKey;
    cta: I18nKey;
  }
> = {
  casual: { name: "p_cas", desc: "p_cas_d", per: "p_cas_per", cta: "cta_cas" },
  fridayMonthly: {
    name: "p_mon_fri",
    desc: "p_mon_fri_d",
    per: "p_mon_fri_per",
    cta: "cta_mon_fri",
  },
  fridayQuarterly: {
    name: "p_qtr_fri",
    desc: "p_qtr_fri_d",
    per: "p_qtr_fri_per",
    cta: "cta_qtr_fri",
  },
  wednesdayMonthly: {
    name: "p_mon_wed",
    desc: "p_mon_wed_d",
    per: "p_mon_wed_per",
    cta: "cta_mon_wed",
  },
  wednesdayQuarterly: {
    name: "p_qtr_wed",
    desc: "p_qtr_wed_d",
    per: "p_qtr_wed_per",
    cta: "cta_qtr_wed",
  },
};

const DEFAULT_FEATURE_KEYS: Record<PlanId, I18nKey[]> = {
  casual: ["f_court_casual", "f_shuttle", "f_racquet"],
  fridayMonthly: ["f_court", "f_shuttle", "f_racquet", "f_community", "f_cancel"],
  fridayQuarterly: [
    "f_court",
    "f_shuttle",
    "f_racquet",
    "f_community",
    "f_priority",
    "f_save",
  ],
  wednesdayMonthly: [
    "f_court_wed",
    "f_shuttle",
    "f_racquet",
    "f_community",
    "f_cancel",
  ],
  wednesdayQuarterly: [
    "f_court_wed",
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

/** Merge CMS rows with defaults so all five plans always render. */
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
    featured: planId === "fridayMonthly",
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

  const split = splitPlanId(plan.planId);
  const modalPriceLabel = !split
    ? `$${priceNzd}`
    : split.tier === "monthly"
      ? `$${priceNzd}/4wk`
      : `$${priceNzd}/12wk`;

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
