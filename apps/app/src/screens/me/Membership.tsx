// The membership card (what they have) and the join card (the way in), as on
// the website. Changing, renewing or cancelling are card payments: they move
// into the app with the membership step; until then they open on the club's
// website.
import type { Me } from "./data.ts";
import { dayLabel, money } from "../../lib/format.ts";
import { daysName, planName, usePlace, webHref, WebsiteLink } from "./parts.tsx";

type Membership = NonNullable<Me["membership"]>;

const STATUS = {
  active: "mem_status_active",
  ending: "mem_status_ending",
  upcoming: "mem_status_upcoming",
  past_due: "mem_status_past_due",
} as const;

export function MembershipCard({ m }: { m: Membership }) {
  const { t, locale, webUrl } = usePlace();
  const when =
    m.status === "upcoming"
      ? t("mem_starts_on", { date: dayLabel(m.periodStart, locale) })
      : m.autoRenews
        ? t("mem_renews_on", { date: dayLabel(m.periodEnd, locale) })
        : t("mem_ends_on", { date: dayLabel(m.periodEnd, locale) });
  const manage = webHref(webUrl, "/profile");
  return (
    <section className="card stack membership" aria-labelledby="mem-title">
      <div className="card-head">
        <div className="stack-tight">
          <h2 id="mem-title">{t("mem_plan_line", { plan: planName(t, m.plan), day: daysName(t, m.day) })}</h2>
          <p className="muted small">
            {m.autoRenews ? t("mem_auto_renews") : t("mem_one_time")}
            {m.method === "cash" ? ` · ${t("mem_cash")}` : m.method === "bank_transfer" ? ` · ${t("mem_bank_transfer")}` : ""}
          </p>
        </div>
        <span className={`status status-${m.status}`}>{t(STATUS[m.status])}</span>
      </div>
      <dl className="stats">
        <div className="stat">
          <dt>{t("mem_days_left")}</dt>
          <dd className="stat-value">{m.daysLeft}</dd>
        </div>
        <div className="stat">
          <dt>{m.autoRenews ? t("mem_auto_renews") : t("mem_period", { start: dayLabel(m.periodStart, locale), end: dayLabel(m.periodEnd, locale) })}</dt>
          <dd className="stat-when">{when}</dd>
        </div>
      </dl>
      {m.next && <p className="muted small">✓ {t("mem_continuation", { plan: planName(t, m.next.plan), date: dayLabel(m.next.periodStart, locale, true) })}</p>}
      {manage && <WebsiteLink href={manage}>{t("me_manage")}</WebsiteLink>}
    </section>
  );
}

export function JoinCard({ join }: { join: NonNullable<Me["join"]> }) {
  const { t, currency, webUrl } = usePlace();
  const href = webHref(webUrl, "/profile");
  return (
    <section className="card stack join" aria-labelledby="join-title">
      <div className="stack-tight">
        <h2 id="join-title">{t("mem_join_title")}</h2>
        <p className="muted">{t("mem_join_sub")}</p>
      </div>
      <ul className="plans">
        <li className="plan">
          <span className="plan-name">{t("mem_monthly")}</span>
          <span className="plan-price">
            {money(join.monthly, currency)} <span className="muted small">{t("mem_per_4w")}</span>
          </span>
        </li>
        <li className="plan plan-best">
          <span className="plan-name">
            {t("mem_quarterly")} <span className="tag">{t("mem_best_value")}</span>
          </span>
          <span className="plan-price">
            {money(join.quarterly, currency)} <span className="muted small">{t("mem_per_12w")}</span>
          </span>
        </li>
      </ul>
      {join.days.length > 0 && <p className="muted small">{join.days.map((d) => daysName(t, d)).join(" · ")}</p>}
      {href && (
        <WebsiteLink href={href} className="button button-primary">
          {t("me_join")}
        </WebsiteLink>
      )}
    </section>
  );
}
