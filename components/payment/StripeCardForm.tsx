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

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function PaymentFormInner({
  amountLabel,
  onSuccess,
}: {
  amountLabel: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { tr } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/?payment=success`,
      },
      redirect: "if_required",
    });

    if (submitError) {
      setError(submitError.message ?? "Payment failed");
      setLoading(false);
      return;
    }

    onSuccess();
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
        {loading ? tr("processing") : amountLabel}
      </button>
    </form>
  );
}

export function StripeCardForm({
  clientSecret,
  amountLabel,
  onSuccess,
}: {
  clientSecret: string | null;
  amountLabel: string;
  onSuccess: () => void;
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
      <PaymentFormInner amountLabel={amountLabel} onSuccess={onSuccess} />
    </Elements>
  );
}
