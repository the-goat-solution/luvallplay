import { eq } from "drizzle-orm";
import { orm, schema } from "../database.ts";

const { memberships } = schema;

/** Mirrors a membership subscription's status (and cancel flag) from Stripe. */
export async function setMembershipStatusBySubscription(stripeSubscriptionId: string, status: string, cancelAtPeriodEnd?: boolean): Promise<void> {
  await orm()
    .update(memberships)
    .set(cancelAtPeriodEnd === undefined ? { status } : { status, cancel_at_period_end: cancelAtPeriodEnd })
    .where(eq(memberships.stripe_subscription_id, stripeSubscriptionId));
}
