// Stripe.js, loaded only when a payment step opens (it isn't in the app's
// own code, and nothing of Stripe's runs before). The page's
// Content-Security-Policy allows exactly Stripe's published hosts.
type StripeResult = { error?: { message?: string }; paymentIntent?: { id: string; status: string }; setupIntent?: { id: string; status: string } };
export type StripeElement = { mount(el: HTMLElement): void; destroy(): void; on(event: "ready" | "change", cb: (e?: { complete?: boolean }) => void): void };
export type StripeElements = { create(type: "payment", options?: Record<string, unknown>): StripeElement; submit(): Promise<{ error?: { message?: string } }> };
export type Stripe = {
  elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements;
  confirmPayment(options: { elements: StripeElements; confirmParams: { return_url: string }; redirect: "if_required" }): Promise<StripeResult>;
  confirmSetup(options: { elements: StripeElements; confirmParams: { return_url: string }; redirect: "if_required" }): Promise<StripeResult>;
};
declare global {
  interface Window {
    Stripe?: (key: string) => Stripe;
  }
}

const SRC = "https://js.stripe.com/v3/";
let script: Promise<void> | null = null;
const instances = new Map<string, Stripe>();

export async function loadStripe(key: string): Promise<Stripe> {
  if (!window.Stripe) {
    script ??= new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SRC;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        script = null;
        reject(new Error("stripe"));
      };
      document.head.append(el);
    });
    await script;
  }
  if (!window.Stripe) throw new Error("stripe");
  let s = instances.get(key);
  if (!s) instances.set(key, (s = window.Stripe(key)));
  return s;
}
