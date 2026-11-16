"use client";

import dynamic from "next/dynamic";

// Stripe's card form (and Stripe.js) only loads when a payment sheet opens,
// so the profile tabs stay light on first load.
export const StripeCardForm = dynamic(
  () => import("@/components/payment/StripeCardForm").then((m) => m.StripeCardForm),
  { ssr: false, loading: () => <p style={{ padding: "18px 0", color: "var(--text-light)", fontSize: 14 }}>…</p> },
);
