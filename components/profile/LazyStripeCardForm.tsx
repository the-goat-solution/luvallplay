"use client";

import dynamic from "next/dynamic";
import { LoadingIcon } from "@/components/LoadingIcon";

// Stripe's card form (and Stripe.js) only loads when a payment sheet opens,
// so the profile tabs stay light on first load.
export const StripeCardForm = dynamic(
  () => import("@/components/payment/StripeCardForm").then((m) => m.StripeCardForm),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 0", color: "var(--text-light)", fontSize: 14 }}>
        <LoadingIcon size="sm" />
        …
      </div>
    ),
  },
);
