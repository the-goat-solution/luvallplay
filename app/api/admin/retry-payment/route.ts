import { NextResponse } from "next/server";
import { z } from "zod";
import Stripe from "stripe";
import { getMembershipById } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit, getClientIp, isAdminRequest } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  membershipId: z.number().int().positive(),
});

// Re-attempts the member's outstanding invoice against the card Stripe
// already has on file. Stripe retries a failed renewal on its own dunning
// schedule (typically days apart); this is the "they say they've topped up,
// try it now" button, so the admin doesn't have to wait for that schedule or
// open the Stripe dashboard.
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`admin-retry:${ip}`, 20)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json(
      { error: "Database is not configured" },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const membership = await getMembershipById(body.membershipId);
  if (!membership) {
    return NextResponse.json(
      { error: "Membership not found" },
      { status: 404 },
    );
  }
  if (!membership.stripeSubscriptionId) {
    return NextResponse.json(
      {
        error:
          "This member has no Stripe subscription to retry — cash and one-time memberships are paid outside Stripe.",
      },
      { status: 400 },
    );
  }

  const stripe = getStripe();

  // The oldest open invoice first: if dunning has let more than one cycle go
  // unpaid, clearing them in order is what the member actually owes next.
  let invoice: Stripe.Invoice | undefined;
  try {
    const invoices = await stripe.invoices.list({
      subscription: membership.stripeSubscriptionId,
      status: "open",
      limit: 100,
    });
    invoice = invoices.data.sort((a, b) => a.created - b.created)[0];
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Could not reach Stripe";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!invoice?.id) {
    return NextResponse.json(
      {
        error:
          "No unpaid invoice found in Stripe for this member — nothing to retry.",
      },
      { status: 409 },
    );
  }

  // Captured before the attempt: a decline throws, and the admin still needs
  // the link to send the member so they can pay on a different card.
  const invoiceUrl = invoice.hosted_invoice_url ?? null;

  try {
    const paid = await stripe.invoices.pay(invoice.id);
    // A successful charge also reaches us as invoice.payment_succeeded and
    // customer.subscription.updated, which is what moves the membership back
    // to 'active' and extends period_end (see the Stripe webhook route). We
    // deliberately don't duplicate that write here — letting the webhook own
    // it keeps the renewal idempotent against its own at-least-once delivery.
    return NextResponse.json({
      ok: true,
      status: paid.status,
      amountPaid: paid.amount_paid,
    });
  } catch (e) {
    // A declined card is a Stripe *error*, not a failed-but-returned invoice.
    // Surface the bank's own wording — "insufficient funds" and "expired
    // card" need completely different follow-ups from the admin.
    const declineCode =
      e instanceof Stripe.errors.StripeError
        ? ((e.raw as { decline_code?: string } | undefined)?.decline_code ??
          e.code ??
          null)
        : null;
    const message =
      e instanceof Stripe.errors.StripeError
        ? e.message
        : e instanceof Error
          ? e.message
          : "The retry failed";
    return NextResponse.json(
      { error: message, declineCode, invoiceUrl },
      { status: 402 },
    );
  }
}
