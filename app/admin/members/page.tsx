import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import { revalidatePath } from "next/cache";
import {
  activateMembershipByPaymentIntentId,
  assignAndReserveMembershipAccessStart,
  attachStripeIdToMembership,
  ensureTables,
  getTotalActiveMemberCount,
  listMemberships,
  type MembershipRow,
} from "@/lib/db";
import { getClubToday } from "@/lib/dates";
import { getStripe } from "@/lib/stripe";
import { sendMembershipConfirmationEmail } from "@/lib/email";
import { MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "@/lib/constants";
import { AdminNav } from "@/components/admin/AdminNav";
import adminStyles from "@/components/admin/admin.module.css";
import { CashMemberDayAndDateFields } from "@/components/admin/CashMemberDayAndDateFields";
import { MemberCancelButton } from "@/components/admin/MemberCancelButton";
import { MemberRetryButton } from "@/components/admin/MemberRetryButton";
import { MemberFreeMonthButton } from "@/components/admin/MemberFreeMonthButton";
import { MembersToastBridge } from "@/components/admin/MembersToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";

export const dynamic = "force-dynamic";

const MEMBERSHIP_PRICE_CENTS: Record<"monthly" | "quarterly", number> = {
  monthly: MONTHLY_PRICE_CENTS,
  quarterly: QUARTERLY_PRICE_CENTS,
};

// Records a monthly/quarterly membership paid in cash: reserves the same
// access-start slot the online signup flow would (so cash members count
// against play-day capacity exactly like card members), records a Stripe
// customer + invoice marked paid out-of-band (so Stripe stays the source of
// truth for who's a paying member, without ever charging a card), then
// activates the membership and sends the same confirmation email a card
// payment would trigger.
async function addCashMember(formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const plan = formData.get("plan") === "quarterly" ? "quarterly" : "monthly";
  const day = formData.get("day") === "wednesday" ? "wednesday" : "friday";
  const dayLabel = day === "wednesday" ? "Wednesday" : "Friday";
  const startDate = String(formData.get("startDate") ?? "").trim();

  if (!firstName || !lastName || !email) {
    redirect(
      `/admin/members?cashMemberError=${encodeURIComponent("Name and email are required")}`,
    );
  }

  await ensureTables();

  const assignment = await assignAndReserveMembershipAccessStart(
    plan,
    day,
    {
      email,
      firstName,
      lastName,
      phone: phone || null,
      recurring: false,
    },
    startDate || undefined,
  );
  if (assignment.blocked) {
    const message =
      assignment.reason === "already_member"
        ? `This email already has an active ${dayLabel} membership.`
        : assignment.reason === "invalid_date"
          ? "That start date is no longer available — pick another."
          : `No upcoming ${dayLabel} session has room for a new membership right now.`;
    redirect(`/admin/members?cashMemberError=${encodeURIComponent(message)}`);
  }

  const amount = MEMBERSHIP_PRICE_CENTS[plan];
  let invoiceId: string;
  try {
    const stripe = getStripe();

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer =
      customers.data[0] ??
      (await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        phone: phone || undefined,
        metadata: { plan, day },
      }));

    await stripe.invoiceItems.create({
      customer: customer.id,
      amount,
      currency: "nzd",
      description: `Three Wolves — ${plan === "monthly" ? "Monthly" : "Quarterly"} Membership (${dayLabel}) — cash`,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 1,
      auto_advance: false,
      pending_invoice_items_behavior: "include",
      metadata: {
        type: "membership",
        plan,
        day,
        firstName,
        lastName,
        email,
        phone,
        source: "cash",
        membershipId: String(assignment.membershipId),
      },
    });

    if (!invoice.id) throw new Error("Failed to create invoice");
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.pay(finalized.id!, { paid_out_of_band: true });
    invoiceId = finalized.id!;
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to record cash payment";
    // The reserved membership row is left 'pending' — it stops counting
    // toward play-day capacity after PENDING_MEMBERSHIP_HOLD_MINUTES, the
    // same as an abandoned online checkout, so nothing else to clean up.
    redirect(`/admin/members?cashMemberError=${encodeURIComponent(message)}`);
  }

  const paymentIntentId = `cash-invoice-${invoiceId}`;
  await attachStripeIdToMembership(assignment.membershipId, {
    stripePaymentIntentId: paymentIntentId,
  });

  // Guarded the same way the Stripe webhook activates card memberships, so
  // it's safe if the webhook for this same invoice also fires and races us.
  const activated = await activateMembershipByPaymentIntentId(paymentIntentId);
  if (activated?.periodStart && activated.periodEnd) {
    const { dateKey: clubToday } = getClubToday();
    await sendMembershipConfirmationEmail(activated.email, {
      firstName: activated.name,
      plan: activated.plan,
      day: activated.day,
      priceNzd: amount / 100,
      recurring: false,
      periodStart: activated.periodStart,
      periodEnd: activated.periodEnd,
      delayed: activated.periodStart > clubToday,
    }).catch((err) =>
      console.error("Failed to send membership confirmation email", err),
    );
  }

  revalidatePath("/admin/members");
  redirect("/admin/members?cashMemberAdded=1");
}

// Stripe subscription statuses that mean an invoice is sitting unpaid:
// 'past_due' is a failed renewal in dunning, 'unpaid' is one Stripe has
// given up retrying, and 'incomplete' is a first payment that never
// completed. Each one has an outstanding invoice the admin can re-attempt.
const OVERDUE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

function MembersTable({
  title,
  members,
}: {
  title: string;
  members: MembershipRow[];
}) {
  const { dateKey: today } = getClubToday();
  return (
    <div style={{ marginBottom: 36 }}>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>
        {title} ({members.length})
      </p>
      <div className={adminStyles.tableWrap}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Email</th>
              <th style={{ padding: "6px 8px" }}>Phone</th>
              <th style={{ padding: "6px 8px" }}>Day</th>
              <th style={{ padding: "6px 8px" }}>Renews / ends</th>
              <th style={{ padding: "6px 8px" }}>Billing</th>
              <th style={{ padding: "6px 8px" }}>Payment</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: "10px 8px", color: "#888" }}>
                  No {title.toLowerCase()}.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 8px" }}>{m.name}</td>
                  <td style={{ padding: "6px 8px" }}>{m.email}</td>
                  <td style={{ padding: "6px 8px" }}>{m.phone ?? ""}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {m.day === "wednesday" ? "Wed" : "Fri"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{m.periodEnd ?? ""}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {m.recurring ? "Auto-renews" : "One-time"}
                    {m.freeDaysGranted ? (
                      <div style={{ fontSize: 12, color: "#1a7a3c" }}>
                        +{Math.round(m.freeDaysGranted / 7)} wks free given
                      </div>
                    ) : null}
                    {!m.recurring && m.renewalReminderSentAt ? (
                      <div style={{ fontSize: 12, color: "#666" }}>
                        Renewal email sent{" "}
                        {new Date(m.renewalReminderSentAt).toLocaleDateString("en-NZ", {
                          timeZone: "Pacific/Auckland",
                          day: "numeric",
                          month: "short",
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {m.method === "cash" ? "Cash" : "Card"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {m.cancelAtPeriodEnd ? (
                      <span style={{ color: "#b00020" }}>
                        Cancels {m.periodEnd ?? "at period end"}
                      </span>
                    ) : (
                      <span
                        style={{
                          color: OVERDUE_STATUSES.has(m.status)
                            ? "#b00020"
                            : "#1a7a3c",
                          textTransform: "capitalize",
                        }}
                      >
                        {m.status.replace("_", " ")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                      }}
                    >
                      {OVERDUE_STATUSES.has(m.status) && m.stripeSubscriptionId ? (
                        <MemberRetryButton
                          membershipId={m.id}
                          memberName={m.name}
                        />
                      ) : null}
                      {m.status === "active" &&
                      (m.recurring
                        ? !m.cancelAtPeriodEnd && m.stripeSubscriptionId
                        : m.periodEnd && m.periodEnd >= today) ? (
                        <MemberFreeMonthButton
                          membershipId={m.id}
                          memberName={m.name}
                          periodEnd={m.periodEnd}
                          plan={m.plan}
                          recurring={m.recurring}
                        />
                      ) : null}
                      {m.recurring && !m.cancelAtPeriodEnd ? (
                        <MemberCancelButton
                          membershipId={m.id}
                          memberName={m.name}
                          mode="cancel"
                        />
                      ) : !m.recurring ? (
                        <MemberCancelButton
                          membershipId={m.id}
                          memberName={m.name}
                          mode="remove"
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function MembersAdminPage() {
  const { memberships, activeMemberCount } = process.env.POSTGRES_URL
    ? await (async () => {
        await ensureTables();
        const [memberships, activeMemberCount] = await Promise.all([
          listMemberships(),
          getTotalActiveMemberCount(),
        ]);
        return { memberships, activeMemberCount };
      })()
    : { memberships: [], activeMemberCount: 0 };

  const monthly = memberships.filter((m) => m.plan === "monthly");
  const quarterly = memberships.filter((m) => m.plan === "quarterly");

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Members</h1>
      <p className={adminStyles.subtitle}>
        Monthly and quarterly members with an active subscription.
      </p>
      <AdminNav active="members" />
      <MembersToastBridge />

      {!process.env.POSTGRES_URL ? (
        <p>Database is not configured.</p>
      ) : (
        <>
          <p
            style={{
              background: "#eef2f7",
              color: "#1a2a4a",
              padding: "10px 14px",
              borderRadius: 6,
              marginBottom: 20,
              fontSize: 13,
            }}
          >
            {activeMemberCount} active member
            {activeMemberCount === 1 ? "" : "s"} total — capacity varies per
            play day and per member&apos;s active period, see the{" "}
            <AdminLink href="/admin/play-days">Play days</AdminLink> page for a specific date.
          </p>
          <MembersTable title="Monthly members" members={monthly} />
          <MembersTable title="Quarterly members" members={quarterly} />

          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 8 }}>
            Add cash member
          </h2>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 12 }}>
            Records a Stripe customer and invoice marked as paid out-of-band
            (cash), assigns them the next session with room on the chosen day,
            and sends the same welcome email a card signup would get.
          </p>
          <form
            action={addCashMember}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "flex-end",
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>
                First name
              </label>
              <input
                name="firstName"
                required
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>
                Last name
              </label>
              <input
                name="lastName"
                required
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>
                Email
              </label>
              <input
                type="email"
                name="email"
                required
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>
                Phone (optional)
              </label>
              <input
                name="phone"
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#666" }}>
                Plan
              </label>
              <select
                name="plan"
                defaultValue="monthly"
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  fontSize: 13,
                }}
              >
                <option value="monthly">Monthly ($33)</option>
                <option value="quarterly">Quarterly ($85)</option>
              </select>
            </div>
            <CashMemberDayAndDateFields />
            <SubmitButton
              loadingText="Adding…"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #1a2a4a",
                background: "#1a2a4a",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Add cash member
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
