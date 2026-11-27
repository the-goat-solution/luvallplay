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
import { clubLocale, membershipDescription, parseMembershipDay } from "@/lib/club-brand";
import { adminText } from "@/lib/admin-lang";
import type { AdminKey } from "@luvallplay/i18n/admin";

type T = Awaited<ReturnType<typeof adminText>>["t"];
const dayName = (t: T, d: string) => t(`weekday_${d}` as AdminKey);
const dayPlural = (t: T, d: string) => t(`weekdays_${d}` as AdminKey);
const METHOD_KEY = { card: "play_method_card", cash: "play_method_cash", bank_transfer: "play_method_bank_transfer" } as const satisfies Record<string, AdminKey>;

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
  const { t } = await adminText();

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const plan = formData.get("plan") === "quarterly" ? "quarterly" : "monthly";
  const day = parseMembershipDay(formData.get("day"));
  const dayLabel = dayName(t, day);
  const startDate = String(formData.get("startDate") ?? "").trim();
  const method = parseOfflineMethod(formData.get("method"));

  if (!firstName || !lastName || !email) {
    redirect(
      `/admin/members?cashMemberError=${encodeURIComponent(t("mem_err_required"))}`,
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
        ? t("mem_err_already", { day: dayLabel })
        : assignment.reason === "invalid_date"
          ? t("mem_err_date")
          : t("mem_err_room", { day: dayLabel });
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
      description: membershipDescription(plan, day),
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
      e instanceof Error ? e.message : t("play_err_record");
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
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString(clubLocale(), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }) : "—";

function TransferStatus({ status, t }: { status: OfflineReconciliation | undefined; t: T }) {
  return status?.reconciled ? (
    <span className={kit.sub} style={{ color: "#1a7a3c" }}>
      {status.bankDate ? t("play_matched_on", { date: day(status.bankDate) }) : t("play_matched")}
    </span>
  ) : (
    <span className={kit.sub} style={{ color: "#8a4b00" }}>
      {t("play_waiting_transfer")}
    </span>
  );
}

function statusOf(t: T, m: MembershipRow, today: string): { label: string; tone: BadgeTone; urgent: boolean } {
  if (m.status === "past_due") return { label: t("mem_st_past_due"), tone: "bad", urgent: true };
  if (m.status === "unpaid") return { label: t("mem_st_unpaid"), tone: "bad", urgent: true };
  if (m.status === "incomplete") return { label: t("mem_st_incomplete"), tone: "bad", urgent: true };
  if (m.cancelAtPeriodEnd) return { label: t("mem_st_stops", { date: day(m.periodEnd) }), tone: "warn", urgent: false };
  if (!m.recurring && m.periodEnd && m.periodEnd < today) return { label: t("mem_st_ended"), tone: "default", urgent: false };
  if (m.status === "trialing") return { label: t("mem_st_trial"), tone: "good", urgent: false };
  if (m.status === "active") return { label: t("mem_st_active"), tone: "good", urgent: false };
  return { label: m.status.replace(/_/g, " "), tone: "default", urgent: false };
}

function MembersTable({ members, reconciliation, today, t }: { members: MembershipRow[]; reconciliation: Map<string, OfflineReconciliation>; today: string; t: T }) {
  // Problems first, then by name.
  const rows = [...members].sort((a, b) => Number(statusOf(t, b, today).urgent) - Number(statusOf(t, a, today).urgent) || a.name.localeCompare(b.name));
  return (
    <div className={kit.tableWrap}>
      <table className={kit.table}>
        <caption className={kit.srOnly}>{t("mem_caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("mem_col_member")}</th>
            <th scope="col">{t("mem_col_plan")}</th>
            <th scope="col">{t("mem_col_period")}</th>
            <th scope="col">{t("mem_col_payment")}</th>
            <th scope="col">{t("mem_col_status")}</th>
            <th scope="col">
              <span className={kit.srOnly}>{t("play_col_actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const st = statusOf(t, m, today);
            return (
              <tr key={m.id}>
                <td data-label={t("mem_col_member")}>
                  <div>
                    <strong>{m.name}</strong>
                    <span className={kit.sub}>
                      {m.email}
                      {m.phone ? ` · ${m.phone}` : ""}
                    </span>
                  </div>
                </td>
                <td data-label={t("mem_col_plan")}>
                  <div>
                    {m.plan === "quarterly" ? t("mem_plan_quarterly_short") : t("mem_plan_monthly_short")} · {dayPlural(t, m.day)}
                    <span className={kit.sub}>{m.recurring ? t("mem_renews_auto") : t("mem_one_time")}</span>
                    {m.freeDaysGranted ? (
                      <span className={kit.sub} style={{ color: "#1a7a3c" }}>
                        {t("mem_free_weeks", { n: Math.round(m.freeDaysGranted / 7) })}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td data-label={t("mem_col_period")}>
                  <div>
                    {day(m.periodStart)} → {day(m.periodEnd)}
                    {!m.recurring && m.renewalReminderSentAt ? <span className={kit.sub}>{t("mem_reminder_sent", { date: formatNz(m.renewalReminderSentAt) })}</span> : null}
                  </div>
                </td>
                <td data-label={t("mem_col_payment")}>
                  <div>
                    {t(METHOD_KEY[m.method])}
                    {m.method === "bank_transfer" ? <TransferStatus t={t} status={reconciliation.get(offlineInvoiceIdFromRef(m.stripePaymentIntentId) ?? "")} /> : null}
                  </div>
                </td>
                <td data-label={t("mem_col_status")}>
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
  const { t } = await adminText();
  const { tab: tabParam, plan: planParam } = await searchParams;
  const tab: Tab = tabParam === "ended" || tabParam === "leaving" ? tabParam : "active";
  const plan: PlanFilter = planParam === "monthly" || planParam === "quarterly" ? planParam : "all";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title={t("mem_title")} />
        <EmptyState>{t("play_no_db")}</EmptyState>
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
      <PageHeader title={t("mem_title")} subtitle={t("mem_subtitle")} actions={<StripeSyncButton />} />

      <StatGrid>
        <StatTile label={t("mem_stat_active")} value={activeMemberCount} hint={<AdminLink href="/admin/play-days">{t("mem_stat_places")}</AdminLink>} />
        <StatTile label={t("mem_stat_monthly")} value={memberships.filter((m) => m.plan === "monthly").length} />
        <StatTile label={t("mem_stat_quarterly")} value={memberships.filter((m) => m.plan === "quarterly").length} />
        <StatTile label={t("mem_stat_problems")} value={failing} tone={failing ? "bad" : undefined} hint={failing ? t("mem_listed_first") : t("mem_none")} />
      </StatGrid>

      {audit && audit.changed.length > 0 ? (
        <Notice>
          {t(audit.changed.length === 1 ? "mem_audit_ended_one" : "mem_audit_ended_many", {
            n: audit.changed.length,
            list: audit.changed.map((c) => t("mem_audit_item", { name: c.name, date: day(c.periodEnd) })).join("; "),
          })}
        </Notice>
      ) : null}
      {audit && audit.errors > 0 ? (
        <Notice tone="error">
          {t(audit.errors === 1 ? "mem_audit_err_one" : "mem_audit_err_many", { n: audit.errors })}
        </Notice>
      ) : null}

      <Tabs
        label={t("mem_title")}
        current={tab}
        items={[
          { key: "active", label: t("mem_tab_members"), href: tabHref("active"), count: memberships.length },
          { key: "ended", label: t("mem_tab_ended"), href: tabHref("ended"), count: recentlyEnded.length },
          { key: "leaving", label: t("mem_tab_leaving"), href: tabHref("leaving"), count: feedback.length },
        ]}
      />

      {tab === "active" && (
        <>
          <div className={kit.toolbar}>
            <FormPanel summary={t("mem_add_summary")} title={t("mem_add_title")} id="add">
              <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
                {t("mem_add_intro_a")}
                <AdminLink href="/admin/financials/bank">{t("nav_bank")}</AdminLink>
                {t("play_add_intro_b")}
              </p>
              <form action={addOfflineMember} className={kit.formGrid}>
                <label className={kit.field}>
                  {t("play_first_name")}
                  <input name="firstName" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  {t("play_last_name")}
                  <input name="lastName" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  {t("play_email")}
                  <input type="email" name="email" required className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  {t("play_phone_optional")}
                  <input name="phone" className={kit.input} autoComplete="off" />
                </label>
                <label className={kit.field}>
                  {t("mem_plan")}
                  <select name="plan" defaultValue="monthly" className={kit.select}>
                    <option value="monthly">{t("mem_plan_monthly_price", { price: clubMoney(MONTHLY_PRICE_CENTS) })}</option>
                    <option value="quarterly">{t("mem_plan_quarterly_price", { price: clubMoney(QUARTERLY_PRICE_CENTS) })}</option>
                  </select>
                </label>
                <OfflinePaymentMethodField />
                <div style={{ gridColumn: "1 / -1" }}>
                  <CashMemberDayAndDateFields />
                </div>
                <div>
                  <SubmitButton className={kit.btn} loadingText={t("play_adding")}>
                    {t("mem_add_btn")}
                  </SubmitButton>
                </div>
              </form>
            </FormPanel>
          </div>

          <nav className={kit.rowActions} aria-label={t("mem_plan_nav")} style={{ marginBottom: 10 }}>
            {(["all", "monthly", "quarterly"] as const).map((p) => (
              <AdminLink key={p} href={planHref(p)} current={p === plan} className={p === plan ? kit.btn : kit.btnSecondary}>
                {p === "all" ? t("mem_all_plans") : p === "monthly" ? t("mem_plan_monthly_short") : t("mem_plan_quarterly_short")}
              </AdminLink>
            ))}
          </nav>

          {shown.length === 0 ? <EmptyState>{t("mem_none_on_plan")}</EmptyState> : <MembersTable t={t} members={shown} reconciliation={reconciliation} today={getClubToday(new Date(), await clubClock()).dateKey} />}

          <InfoDisclosure summary={t("mem_actions_summary")}>
            <p>
              <strong>{t("mem_actions_1_a")}</strong>
              {t("mem_actions_1_b")}
              <strong>{t("mem_actions_1_c")}</strong>
              {t("mem_actions_1_d")}
            </p>
            <p>
              <strong>{t("mem_actions_2_a")}</strong>
              {t("mem_actions_2_b")}
              <strong>{t("mem_actions_2_c")}</strong>
              {t("mem_actions_2_d")}
            </p>
          </InfoDisclosure>
        </>
      )}

      {tab === "ended" &&
        (recentlyEnded.length === 0 ? (
          <EmptyState>{t("mem_ended_none")}</EmptyState>
        ) : (
          <>
            <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
              {t("mem_ended_intro")}
            </p>
            <div className={kit.tableWrap}>
              <table className={kit.table}>
                <caption className={kit.srOnly}>{t("mem_ended_caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("mem_col_member")}</th>
                    <th scope="col">{t("mem_col_plan")}</th>
                    <th scope="col">{t("mem_col_period")}</th>
                    <th scope="col">{t("mem_col_ended")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentlyEnded.map((m) => (
                    <tr key={m.id}>
                      <td data-label={t("mem_col_member")}>
                        <div>
                          {m.name}
                          <span className={kit.sub}>{m.email}</span>
                        </div>
                      </td>
                      <td data-label={t("mem_col_plan")}>
                        {m.plan === "quarterly" ? t("mem_plan_quarterly_short") : t("mem_plan_monthly_short")} · {dayPlural(t, m.day)} ·{" "}
                        {m.recurring ? t("mem_plan_auto") : t("mem_plan_onetime")}
                      </td>
                      <td data-label={t("mem_col_period")}>
                        {day(m.periodStart)} → {day(m.periodEnd)}
                      </td>
                      <td data-label={t("mem_col_ended")}>
                        <div className={kit.rowActions}>
                          <Badge>{m.status === "canceled" ? t("mem_cancelled") : t("mem_st_ended")}</Badge>
                          <AdminLink href={`/admin/inbox?to=${encodeURIComponent(m.email)}#new`} className={kit.btnSecondary}>
                            {t("ppl_message")}
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
          <EmptyState>{t("mem_feedback_none")}</EmptyState>
        ) : (
          <div className={kit.tableWrap}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>{t("mem_fb_caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("mem_col_member")}</th>
                  <th scope="col">{t("mem_fb_col_did")}</th>
                  <th scope="col">{t("mem_fb_col_why")}</th>
                  <th scope="col">{t("mem_fb_col_when")}</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f, i) => (
                  <tr key={i}>
                    <td data-label={t("mem_col_member")}>
                      <div>
                        {f.name || f.email}
                        {f.name && <span className={kit.sub}>{f.email}</span>}
                      </div>
                    </td>
                    <td data-label={t("mem_fb_col_did")}>{f.action === "cancel" ? t("mem_fb_cancel") : t("mem_fb_switch")}</td>
                    <td data-label={t("mem_fb_col_why")}>
                      <div>
                        {f.reason}
                        {f.comment ? <span className={kit.sub}>&ldquo;{f.comment}&rdquo;</span> : null}
                      </div>
                    </td>
                    <td data-label={t("mem_fb_col_when")}>{formatNz(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
