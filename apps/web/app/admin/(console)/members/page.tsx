import { clubClock } from "@/lib/club";
import { linkMemberAccount } from "@/lib/player-db";
import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin/AdminLink";
import { revalidatePath } from "next/cache";
import { activateMembershipByPaymentIntentId, assignAndReserveMembershipAccessStart, attachStripeIdToMembership, getTotalActiveMemberCount, listMemberMiniGameDates, listMemberships, listRecentlyEndedMemberships, addDays, type MembershipRow } from "@/lib/db";
import {
  auditMembershipStatuses,
  type MembershipAuditResult,
} from "@/lib/membership-status";
import { getClubToday } from "@/lib/dates";
import {
  offlineInvoiceIdFromRef,
  parseOfflineMethod,
  PAYMENT_METHOD_LABEL,
} from "@/lib/offline-payment";
import { reconcileOfflinePayment, recordOfflinePayment } from "@/lib/offline-payment-stripe";
import { getOfflinePaymentReconciliation, type OfflineReconciliation } from "@/lib/bank-db";
import { OfflinePaymentMethodField } from "@/components/admin/OfflinePaymentMethodField";
import { sendMembershipConfirmationEmail } from "@/lib/email";
import { MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "@/lib/constants";
import adminStyles from "@/components/admin/admin.module.css";
import { Badge, EmptyState, FormPanel, InfoDisclosure, Notice, PageHeader, StatGrid, StatTile, Tabs, kit, type BadgeTone } from "@/components/admin/kit";
import { listRecentFeedback } from "@/lib/membership-self-service";
import { formatNz } from "@/components/admin/ui";
import { CashMemberDayAndDateFields } from "@/components/admin/CashMemberDayAndDateFields";
import { MemberCancelButton } from "@/components/admin/MemberCancelButton";
import { MemberRetryButton } from "@/components/admin/MemberRetryButton";
import { MemberFreeMonthButton } from "@/components/admin/MemberFreeMonthButton";
import { StripeSyncButton } from "@/components/admin/StripeSyncButton";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { clubMajor, clubMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const MEMBERSHIP_PRICE_CENTS: Record<"monthly" | "quarterly", number> = {
  monthly: MONTHLY_PRICE_CENTS,
  quarterly: QUARTERLY_PRICE_CENTS,
};

// Records a monthly/quarterly membership paid offline — cash, or a bank
// transfer to the club account: reserves the same access-start slot the
// online signup flow would (so these members count against play-day
// capacity exactly like card members), records a Stripe customer + invoice
// marked paid out-of-band (so Stripe stays the source of truth for who's a
// paying member, without ever charging a card), then activates the
// membership and sends the same confirmation email a card payment would
// trigger. The payment also goes into the finance ledger, where a bank
// transfer is matched to its bank transaction as soon as it's in the feed.
async function addOfflineMember(formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const plan = formData.get("plan") === "quarterly" ? "quarterly" : "monthly";
  const day = formData.get("day") === "wednesday" ? "wednesday" : "friday";
  const dayLabel = day === "wednesday" ? "Wednesday" : "Friday";
  const startDate = String(formData.get("startDate") ?? "").trim();
  const method = parseOfflineMethod(formData.get("method"));

  if (!firstName || !lastName || !email) {
    redirect(
      `/admin/members?cashMemberError=${encodeURIComponent("Name and email are required")}`,
    );
  }

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
  let recorded: Awaited<ReturnType<typeof recordOfflinePayment>>;
  try {
    recorded = await recordOfflinePayment({
      method,
      email,
      firstName,
      lastName,
      phone,
      amountCents: amount,
      description: `Three Wolves — ${plan === "monthly" ? "Monthly" : "Quarterly"} Membership (${dayLabel})`,
      metadata: {
        type: "membership",
        plan,
        day,
        firstName,
        lastName,
        email,
        phone,
        membershipId: String(assignment.membershipId),
      },
      customerMetadata: { plan, day },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to record the payment";
    // The reserved membership row is left 'pending' — it stops counting
    // toward play-day capacity after PENDING_MEMBERSHIP_HOLD_MINUTES, the
    // same as an abandoned online checkout, so nothing else to clean up.
    redirect(`/admin/members?cashMemberError=${encodeURIComponent(message)}`);
  }

  const paymentIntentId = recorded.paymentRef;
  await attachStripeIdToMembership(assignment.membershipId, {
    stripePaymentIntentId: paymentIntentId,
  });

  // Guarded the same way the Stripe webhook activates card memberships, so
  // it's safe if the webhook for this same invoice also fires and races us.
  const activated = await activateMembershipByPaymentIntentId(paymentIntentId);
  if (activated) {
    await linkMemberAccount(activated.email, {
      firstName: activated.firstName,
      lastName: activated.lastName,
      phone: activated.phone,
    }, "admin");
  }
  if (activated?.periodStart && activated.periodEnd) {
    const { dateKey: clubToday } = getClubToday(new Date(), await clubClock());
    await sendMembershipConfirmationEmail(activated.email, {
      firstName: activated.name,
      plan: activated.plan,
      day: activated.day,
      priceNzd: clubMajor(amount),
      recurring: false,
      periodStart: activated.periodStart,
      periodEnd: activated.periodEnd,
      delayed: activated.periodStart > clubToday,
      miniGameDates: await listMemberMiniGameDates(
        activated.day,
        activated.periodStart,
        activated.periodEnd,
      ).catch(() => []),
    }).catch((err) =>
      console.error("Failed to send membership confirmation email", err),
    );
  }

  const reconciled = await reconcileOfflinePayment(recorded, method);

  revalidatePath("/admin/members");
  redirect(`/admin/members?cashMemberAdded=${reconciled === "matched" ? "matched" : method}`);
}

// Stripe subscription statuses that mean an invoice is sitting unpaid:
// 'past_due' is a failed renewal in dunning, 'unpaid' is one Stripe has
// given up retrying, and 'incomplete' is a first payment that never
// completed. Each one has an outstanding invoice the admin can re-attempt.
const OVERDUE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

const day = (key: string | null | undefined) =>
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }) : "—";

function TransferStatus({ status }: { status: OfflineReconciliation | undefined }) {
  return status?.reconciled ? (
    <span className={kit.sub} style={{ color: "#1a7a3c" }}>
      ✓ Matched to the bank{status.bankDate ? ` (${day(status.bankDate)})` : ""}
    </span>
  ) : (
    <span className={kit.sub} style={{ color: "#8a4b00" }}>
      Waiting for the bank transfer
    </span>
  );
}

function statusOf(m: MembershipRow, today: string): { label: string; tone: BadgeTone; urgent: boolean } {
  if (m.status === "past_due") return { label: "Payment failed", tone: "bad", urgent: true };
  if (m.status === "unpaid") return { label: "Payment failed, Stripe stopped retrying", tone: "bad", urgent: true };
  if (m.status === "incomplete") return { label: "First payment not finished", tone: "bad", urgent: true };
  if (m.cancelAtPeriodEnd) return { label: `Stops ${day(m.periodEnd)}`, tone: "warn", urgent: false };
  if (!m.recurring && m.periodEnd && m.periodEnd < today) return { label: "Ended", tone: "default", urgent: false };
  if (m.status === "trialing") return { label: "Trial", tone: "good", urgent: false };
  if (m.status === "active") return { label: "Active", tone: "good", urgent: false };
  return { label: m.status.replace(/_/g, " "), tone: "default", urgent: false };
}

function MembersTable({ members, reconciliation, today }: { members: MembershipRow[]; reconciliation: Map<string, OfflineReconciliation>; today: string }) {
  // Problems first, then by name.
  const rows = [...members].sort((a, b) => Number(statusOf(b, today).urgent) - Number(statusOf(a, today).urgent) || a.name.localeCompare(b.name));
  return (
    <div className={kit.tableWrap}>
      <table className={kit.table}>
        <caption className={kit.srOnly}>Members</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Plan</th>
            <th scope="col">Period</th>
            <th scope="col">Payment</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className={kit.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const st = statusOf(m, today);
            return (
              <tr key={m.id}>
                <td data-label="Member">
                  <div>
                    <strong>{m.name}</strong>
                    <span className={kit.sub}>
                      {m.email}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </span>
                  </div>
                </td>
                <td data-label="Plan">
                  <div>
                    {m.plan === "quarterly" ? "Quarterly" : "Monthly"} · {m.day === "wednesday" ? "Wednesdays" : "Fridays"}
                    <span className={kit.sub}>{m.recurring ? "Renews automatically" : "One-time payment"}</span>
                    {m.freeDaysGranted ? (
                      <span className={kit.sub} style={{ color: "#1a7a3c" }}>
                        +{Math.round(m.freeDaysGranted / 7)} free weeks given
                      </span>
                    ) : null}
                  </div>
                </td>
                <td data-label="Period">
                  <div>
                    {day(m.periodStart)} → {day(m.periodEnd)}
                    {!m.recurring && m.renewalReminderSentAt ? <span className={kit.sub}>Renewal reminder sent {formatNz(m.renewalReminderSentAt)}</span> : null}
                  </div>
                </td>
                <td data-label="Payment">
                  <div>
                    {PAYMENT_METHOD_LABEL[m.method]}
                    {m.method === "bank_transfer" ? <TransferStatus status={reconciliation.get(offlineInvoiceIdFromRef(m.stripePaymentIntentId) ?? "")} /> : null}
                  </div>
                </td>
                <td data-label="Status">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td data-label="">
                  <div className={kit.rowActions}>
                    {OVERDUE_STATUSES.has(m.status) && m.stripeSubscriptionId ? <MemberRetryButton membershipId={m.id} memberName={m.name} /> : null}
                    {m.status === "active" && (m.recurring ? !m.cancelAtPeriodEnd && m.stripeSubscriptionId : m.periodEnd && m.periodEnd >= today) ? (
                      <MemberFreeMonthButton membershipId={m.id} memberName={m.name} periodEnd={m.periodEnd} plan={m.plan} recurring={m.recurring} />
                    ) : null}
                    {m.recurring && !m.cancelAtPeriodEnd ? (
                      <MemberCancelButton membershipId={m.id} memberName={m.name} mode="cancel" />
                    ) : !m.recurring ? (
                      <MemberCancelButton membershipId={m.id} memberName={m.name} mode="remove" />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Tab = "active" | "ended" | "leaving";
type PlanFilter = "all" | "monthly" | "quarterly";

export default async function MembersAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; plan?: string }> }) {
  const { tab: tabParam, plan: planParam } = await searchParams;
  const tab: Tab = tabParam === "ended" || tabParam === "leaving" ? tabParam : "active";
  const plan: PlanFilter = planParam === "monthly" || planParam === "quarterly" ? planParam : "all";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title="Members" />
        <EmptyState>Database is not configured.</EmptyState>
      </div>
    );
  }
  // Same upkeep the daily cron runs, so the list never shows a membership
  // that has already ended as active.
  let audit: MembershipAuditResult | null = null;
  try {
    audit = await auditMembershipStatuses();
  } catch (err) {
    console.error("Membership status audit failed", err);
  }
  const [memberships, activeMemberCount, recentlyEnded, feedback] = await Promise.all([
    listMemberships(),
    getTotalActiveMemberCount(),
    listRecentlyEndedMemberships(addDays(getClubToday(new Date(), await clubClock()).dateKey, -60)),
    listRecentFeedback(30).catch(() => []),
  ]);
  // Bank-transfer members show whether the transfer has been matched yet.
  let reconciliation = new Map<string, OfflineReconciliation>();
  try {
    reconciliation = await getOfflinePaymentReconciliation(
      memberships
        .filter((m) => m.method === "bank_transfer")
        .map((m) => offlineInvoiceIdFromRef(m.stripePaymentIntentId))
        .filter((id): id is string => Boolean(id)),
    );
  } catch (err) {
    console.error("Failed to load bank reconciliation for members", err);
  }

  const failing = memberships.filter((m) => OVERDUE_STATUSES.has(m.status)).length;
  const shown = plan === "all" ? memberships : memberships.filter((m) => m.plan === plan);
  const tabHref = (t: Tab) => (t === "active" ? "/admin/members" : `/admin/members?tab=${t}`);
  const planHref = (p: PlanFilter) => (p === "all" ? "/admin/members" : `/admin/members?plan=${p}`);

  return (
    <div className={adminStyles.page}>
      <PageHeader title="Members" subtitle="Everyone with a monthly or quarterly membership, paid by card, cash or bank transfer." actions={<StripeSyncButton />} />

      <StatGrid>
        <StatTile label="Active members" value={activeMemberCount} hint={<AdminLink href="/admin/play-days">places per play day →</AdminLink>} />
        <StatTile label="Monthly" value={memberships.filter((m) => m.plan === "monthly").length} />
        <StatTile label="Quarterly" value={memberships.filter((m) => m.plan === "quarterly").length} />
        <StatTile label="Payment problems" value={failing} tone={failing ? "bad" : undefined} hint={failing ? "listed first below" : "none"} />
      </StatGrid>

      {audit && audit.changed.length > 0 ? (
        <Notice>
          Marked {audit.changed.length} membership{audit.changed.length === 1 ? "" : "s"} as ended: they were past their end date but still showed as active (
          {audit.changed.map((c) => `${c.name}, ended ${day(c.periodEnd)}`).join("; ")}).
        </Notice>
      ) : null}
      {audit && audit.errors > 0 ? (
        <Notice tone="error">
          {audit.errors} membership{audit.errors === 1 ? "" : "s"} couldn&apos;t be checked with Stripe just now. They&apos;re retried automatically.
        </Notice>
      ) : null}

      <Tabs
        label="Members"
        current={tab}
        items={[
          { key: "active", label: "Members", href: tabHref("active"), count: memberships.length },
          { key: "ended", label: "Ended recently", href: tabHref("ended"), count: recentlyEnded.length },
          { key: "leaving", label: "Why people leave", href: tabHref("leaving"), count: feedback.length },
        ]}
      />

      {tab === "active" && (
        <>
          <div className={kit.toolbar}>
            <FormPanel summary="＋ Add a member" title="Add a member who paid cash or by bank transfer" id="add">
              <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
                They get the same welcome email as a card sign-up and start on the next play day with room on their day (or the date you pick). A bank transfer
                is matched on the <AdminLink href="/admin/financials/bank">Bank</AdminLink> page as soon as it shows up.
              </p>
              <form action={addOfflineMember} className={kit.formGrid}>
                <label className={kit.field}>
                  First name
                  <input name="firstName" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  Last name
                  <input name="lastName" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  Email
                  <input type="email" name="email" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  Phone (optional)
                  <input name="phone" className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  Plan
                  <select name="plan" defaultValue="monthly" className={kit.select}>
                    <option value="monthly">Monthly ({clubMoney(MONTHLY_PRICE_CENTS)})</option>
                    <option value="quarterly">Quarterly ({clubMoney(QUARTERLY_PRICE_CENTS)})</option>
                  </select>
                </label>
                <OfflinePaymentMethodField />
                <div style={{ gridColumn: "1 / -1" }}>
                  <CashMemberDayAndDateFields />
                </div>
                <div>
                  <SubmitButton className={kit.btn} loadingText="Adding…">
                    Add member
                  </SubmitButton>
                </div>
              </form>
            </FormPanel>
          </div>

          <nav className={kit.rowActions} aria-label="Plan" style={{ marginBottom: 10 }}>
            {(["all", "monthly", "quarterly"] as const).map((p) => (
              <AdminLink key={p} href={planHref(p)} current={p === plan} className={p === plan ? kit.btn : kit.btnSecondary}>
                {p === "all" ? "All plans" : p === "monthly" ? "Monthly" : "Quarterly"}
              </AdminLink>
            ))}
          </nav>

          {shown.length === 0 ? <EmptyState>No members on this plan yet.</EmptyState> : <MembersTable members={shown} reconciliation={reconciliation} today={getClubToday(new Date(), await clubClock()).dateKey} />}

          <InfoDisclosure summary="What the actions do">
            <p>
              <strong>Retry payment</strong> charges the card on file for a failed renewal. <strong>Give free month</strong> adds 4 free weeks.
            </p>
            <p>
              <strong>Stop renewing</strong> (card members): they keep playing until the end of the period they&apos;ve paid for. <strong>End now</strong>{" "}
              (one-time members): the membership ends today and the spot is freed. Neither refunds anything.
            </p>
          </InfoDisclosure>
        </>
      )}

      {tab === "ended" &&
        (recentlyEnded.length === 0 ? (
          <EmptyState>No memberships ended in the last 60 days.</EmptyState>
        ) : (
          <>
            <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
              Memberships that ended in the last 60 days: people you might invite back.
            </p>
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>Ended recently</caption>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Period</th>
                    <th scope="col">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {recentlyEnded.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Member">
                        <div>
                          {m.name}
                          <span className={kit.sub}>{m.email}</span>
                        </div>
                      </td>
                      <td data-label="Plan">
                        {m.plan === "quarterly" ? "Quarterly" : "Monthly"} · {m.day === "wednesday" ? "Wednesdays" : "Fridays"} ·{" "}
                        {m.recurring ? "auto-renew" : "one-time"}
                      </td>
                      <td data-label="Period">
                        {day(m.periodStart)} → {day(m.periodEnd)}
                      </td>
                      <td data-label="Ended">
                        <div className={kit.rowActions}>
                          <Badge>{m.status === "canceled" ? "Cancelled" : "Ended"}</Badge>
                          <AdminLink href={`/admin/inbox?to=${encodeURIComponent(m.email)}#new`} className={kit.btnSecondary}>
                            Message
                          </AdminLink>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}

      {tab === "leaving" &&
        (feedback.length === 0 ? (
          <EmptyState>No feedback yet. Members are asked why when they turn off auto-renew or switch plans.</EmptyState>
        ) : (
          <div className={kit.tableWrap}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>Why people leave</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">What they did</th>
                  <th scope="col">Why</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f, i) => (
                  <tr key={i}>
                    <td data-label="Member">
                      <div>
                        {f.name || f.email}
                        {f.name && <span className={kit.sub}>{f.email}</span>}
                      </div>
                    </td>
                    <td data-label="What they did">{f.action === "cancel" ? "Turned off auto-renew" : "Switched to Monthly"}</td>
                    <td data-label="Why">
                      <div>
                        {f.reason}
                        {f.comment ? <span className={kit.sub}>&ldquo;{f.comment}&rdquo;</span> : null}
                      </div>
                    </td>
                    <td data-label="When">{formatNz(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
