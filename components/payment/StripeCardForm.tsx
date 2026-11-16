"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useLanguage } from "@/context/LanguageContext";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function PaymentFormInner({
  amountLabel,
  onSuccess,
  mode,
  returnPath,
}: {
  amountLabel: string;
  onSuccess: (intentId?: string) => void;
  mode: "payment" | "setup";
  returnPath: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { tr } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showLoading = useDelayedLoading(loading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    // "setup" saves a card for later (e.g. switching to auto-renew) without
    // charging anything now.
    const result =
      mode === "setup"
        ? await stripe.confirmSetup({
            elements,
            confirmParams: { return_url: `${window.location.origin}${returnPath}` },
            redirect: "if_required",
          })
        : await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: `${window.location.origin}${returnPath}` },
            redirect: "if_required",
          });

    if (result.error) {
      setError(result.error.message ?? "Payment failed");
      setLoading(false);
      return;
    }

    const intentId =
      "setupIntent" in result && result.setupIntent
        ? result.setupIntent.id
        : "paymentIntent" in result && result.paymentIntent
          ? result.paymentIntent.id
          : undefined;
    onSuccess(intentId);
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label">{tr("card_lbl")}</label>
        <div className="stripe-wrap">
          <PaymentElement />
        </div>
        <p className="form-hint">{tr("card_hint")}</p>
        {error && (
          <p className="form-hint" style={{ color: "var(--bronze-dark)" }}>
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-full"
        disabled={!stripe || loading}
      >
        {showLoading ? (
          <>
            <LoadingIcon size="sm" />
            {tr("processing")}
          </>
        ) : (
          amountLabel
        )}
      </button>
    </form>
  );
}

export function StripeCardForm({
  clientSecret,
  amountLabel,
  onSuccess,
  mode = "payment",
  returnPath = "/?payment=success",
}: {
  clientSecret: string | null;
  amountLabel: string;
  onSuccess: (intentId?: string) => void;
  mode?: "payment" | "setup";
  /** Where Stripe sends the player back after a bank redirect (rare). */
  returnPath?: string;
}) {
  const { tr } = useLanguage();

  if (!stripePromise || !clientSecret) {
    return (
      <p className="form-hint" style={{ padding: "10px 0" }}>
        {tr("payment_note")}
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#C4892A",
            fontFamily: '"Montserrat", sans-serif',
          },
        },
      }}
    >
      <PaymentFormInner amountLabel={amountLabel} onSuccess={onSuccess} mode={mode} returnPath={returnPath} />
    </Elements>
  );
}
