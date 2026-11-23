import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { RenewMembershipForm } from "@/components/renew/RenewMembershipForm";
import { getActiveRenewalOf, getMembershipByRenewalToken } from "@/lib/db";
import { formatEmailDate } from "@/lib/email-layout";

export const dynamic = "force-dynamic";

const DAY_LABEL: Record<string, string> = {
  friday: "Friday",
  wednesday: "Wednesday",
};

// Landing page for the link in a one-time membership's renewal reminder
// email. The token in the link is what opens renewal for that member.
export default async function RenewMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let membership = null;
  let renewal = null;
  if (token && process.env.POSTGRES_URL) {
    try {
      membership = await getMembershipByRenewalToken(token);
      if (membership) renewal = await getActiveRenewalOf(membership.id);
    } catch (err) {
      console.error("Failed to load renewal", err);
      membership = null;
    }
  }
  const valid = Boolean(token && membership && !membership.recurring && membership.periodEnd);
  const dayLabel = membership ? DAY_LABEL[membership.day] ?? membership.day : "";

  return (
    <>
      <Navigation />
      <section
        className="section section-navy"
        style={{ minHeight: "70vh", display: "flex", alignItems: "center" }}
      >
        <div className="container" style={{ maxWidth: 520 }}>
          <div
            style={{
              background: "#fff",
              borderRadius: "var(--radius-lg)",
              padding: "40px 36px",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                color: "var(--navy)",
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: ".04em",
                textAlign: "center",
              }}
            >
              Renew membership
            </h1>

            {!valid || !membership || !token ? (
              <p style={{ color: "var(--text-dark)", lineHeight: 1.7, textAlign: "center" }}>
                This renewal link is invalid or has expired. You can still join
                again any time from the{" "}
                <Link href="/#membership" style={{ color: "var(--bronze)" }}>
                  membership page
                </Link>
                .
              </p>
            ) : renewal ? (
              <p style={{ color: "var(--text-dark)", lineHeight: 1.7, textAlign: "center" }}>
                You&apos;re all set — your {dayLabel} membership is already
                renewed through{" "}
                <strong>{renewal.periodEnd ? formatEmailDate(renewal.periodEnd) : "the next period"}</strong>.
                See you on court!
              </p>
            ) : (
              <RenewMembershipForm
                token={token}
                firstName={membership.firstName || membership.name}
                day={membership.day}
                currentPlan={membership.plan}
                currentEndLabel={formatEmailDate(membership.periodEnd!)}
              />
            )}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
