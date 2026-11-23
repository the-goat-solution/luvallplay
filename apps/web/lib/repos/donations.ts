import { eq } from "drizzle-orm";
import { orm, schema } from "../database.ts";

const { donations } = schema;

/** A new monthly donation, pending until Stripe confirms the first payment. */
export async function insertMonthlyDonation(d: { email: string; firstName: string; lastName: string; amountCents: number; stripeSubscriptionId: string }): Promise<void> {
  await orm()
    .insert(donations)
    .values({
      email: d.email,
      first_name: d.firstName,
      last_name: d.lastName,
      amount_cents: d.amountCents,
      frequency: "monthly",
      stripe_subscription_id: d.stripeSubscriptionId,
      status: "pending",
    })
    .onConflictDoNothing({ target: donations.stripe_subscription_id });
}

/** A one-off donation Stripe has confirmed (webhook; safe to receive twice). */
export async function insertOneTimeDonation(d: { email: string; firstName: string; lastName: string; amountCents: number; stripePaymentIntentId: string }): Promise<void> {
  await orm()
    .insert(donations)
    .values({
      email: d.email,
      first_name: d.firstName,
      last_name: d.lastName,
      amount_cents: d.amountCents,
      frequency: "once",
      stripe_payment_intent_id: d.stripePaymentIntentId,
      status: "succeeded",
    })
    .onConflictDoNothing({ target: donations.stripe_payment_intent_id });
}

/** Mirrors a donation subscription's status from Stripe. */
export async function setDonationStatusBySubscription(stripeSubscriptionId: string, status: string): Promise<void> {
  await orm().update(donations).set({ status }).where(eq(donations.stripe_subscription_id, stripeSubscriptionId));
}
