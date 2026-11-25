// The card step: Stripe's Payment Element in the club's look, then the
// payment (or, for "setup", saving a card without charging). 3-D Secure is
// handled by Stripe in place; only redirect-type methods leave the page.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCurrentClub, useT } from "../hooks.tsx";
import { loadStripe, type Stripe, type StripeElements } from "../lib/stripe.ts";

function appearance() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    theme: document.documentElement.dataset.theme === "dark" ? "night" : "stripe",
    variables: { colorPrimary: v("--primary"), colorText: v("--ink"), colorBackground: v("--surface-raised"), colorDanger: v("--danger"), borderRadius: "8px" },
  };
}

export function CardPayment({
  clientSecret,
  label,
  mode = "payment",
  returnPath,
  onDone,
}: {
  clientSecret: string;
  /** The button, e.g. "Pay $45.00". */
  label: string;
  mode?: "payment" | "setup";
  /** Where Stripe returns to after a redirect-type method (in this app). */
  returnPath: string;
  /** The payment (or the saved card) went through: its id. */
  onDone: (intentId: string | undefined) => void;
}) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const box = useRef<HTMLDivElement>(null);
  const stripe = useRef<{ stripe: Stripe; elements: StripeElements } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = config?.club.stripeKey ?? null;

  useEffect(() => {
    if (!key) return;
    let element: { destroy(): void } | null = null;
    let gone = false;
    loadStripe(key)
      .then((s) => {
        if (gone || !box.current) return;
        const elements = s.elements({ clientSecret, appearance: appearance() });
        const payment = elements.create("payment");
        payment.on("ready", () => setReady(true));
        payment.mount(box.current);
        element = payment;
        stripe.current = { stripe: s, elements };
      })
      .catch(() => setError(t("card_unavailable")));
    return () => {
      gone = true;
      element?.destroy();
    };
  }, [key, clientSecret]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key) return <p className="notice notice-error" role="alert">{t("card_unavailable")}</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s = stripe.current;
    if (!s) return;
    setBusy(true);
    setError(null);
    const args = { elements: s.elements, confirmParams: { return_url: `${window.location.origin}${returnPath}` }, redirect: "if_required" as const };
    const result = mode === "setup" ? await s.stripe.confirmSetup(args) : await s.stripe.confirmPayment(args);
    setBusy(false);
    if (result.error) return setError(result.error.message ?? t("error_generic"));
    onDone(result.setupIntent?.id ?? result.paymentIntent?.id);
  };

  return (
    <form className="stack card-payment" onSubmit={submit}>
      <div className="stack-tight">
        <span className="label">{t("card_lbl")}</span>
        {!ready && !error && <p className="muted small" role="status">{t("card_loading")}</p>}
        <div ref={box} className="card-element" />
        <p className="muted small">{t("card_hint")}</p>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={!ready || busy} aria-busy={busy}>
        {busy ? t("processing") : label}
      </button>
    </form>
  );
}
