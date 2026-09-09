import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { ConfirmCancelForm } from "@/components/cancel/ConfirmCancelForm";
import { RequestNewCancelLinkButton } from "@/components/cancel/RequestNewCancelLinkButton";
import { getMembershipById } from "@/lib/db";
import { verifyCancelToken } from "@/lib/security";

export const dynamic = "force-dynamic";

const PLAN_LABEL: Record<string, string> = {
  monthly: "monthly",
  quarterly: "quarterly",
};

const DAY_LABEL: Record<string, string> = {
  friday: "Friday",
  wednesday: "Wednesday",
};

export default async function ConfirmCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let membershipId: number | null = null;
  if (token && process.env.POSTGRES_URL) {
    try {
      membershipId = verifyCancelToken(token);
    } catch {
      membershipId = null;
    }
  }
  const membership = membershipId ? await getMembershipById(membershipId) : null;

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
              textAlign: "center",
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
              }}
            >
              Confirm cancellation
            </h1>

            {!token || !membership ? (
              <p style={{ color: "var(--text-dark)", lineHeight: 1.7 }}>
                This link is invalid or has expired.{" "}
                <RequestNewCancelLinkButton />.
              </p>
            ) : (
              <ConfirmCancelForm
                token={token}
                planLabel={`${PLAN_LABEL[membership.plan] ?? membership.plan} (${DAY_LABEL[membership.day] ?? membership.day})`}
                periodEnd={membership.periodEnd}
                alreadyScheduled={
                  membership.cancelAtPeriodEnd || membership.status === "canceled"
                }
              />
            )}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
