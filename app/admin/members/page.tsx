import { ensureTables, listMemberships, type MembershipRow } from "@/lib/db";
import { AdminNav } from "@/components/admin/AdminNav";
import { MemberCancelButton } from "@/components/admin/MemberCancelButton";

export const dynamic = "force-dynamic";

function MembersTable({ title, members }: { title: string; members: MembershipRow[] }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>
        {title} ({members.length})
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "6px 8px" }}>Name</th>
            <th style={{ padding: "6px 8px" }}>Email</th>
            <th style={{ padding: "6px 8px" }}>Phone</th>
            <th style={{ padding: "6px 8px" }}>Renews / ends</th>
            <th style={{ padding: "6px 8px" }}>Billing</th>
            <th style={{ padding: "6px 8px" }}>Status</th>
            <th style={{ padding: "6px 8px" }}></th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: "10px 8px", color: "#888" }}>
                No {title.toLowerCase()}.
              </td>
            </tr>
          ) : (
            members.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 8px" }}>{m.name}</td>
                <td style={{ padding: "6px 8px" }}>{m.email}</td>
                <td style={{ padding: "6px 8px" }}>{m.phone ?? ""}</td>
                <td style={{ padding: "6px 8px" }}>{m.periodEnd ?? ""}</td>
                <td style={{ padding: "6px 8px" }}>
                  {m.recurring ? "Auto-renews" : "One-time"}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {m.cancelAtPeriodEnd ? (
                    <span style={{ color: "#b00020" }}>
                      Cancels {m.periodEnd ?? "at period end"}
                    </span>
                  ) : (
                    <span style={{ color: "#1a7a3c", textTransform: "capitalize" }}>
                      {m.status}
                    </span>
                  )}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {m.recurring && !m.cancelAtPeriodEnd && (
                    <MemberCancelButton membershipId={m.id} memberName={m.name} />
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function MembersAdminPage() {
  const memberships = process.env.POSTGRES_URL
    ? await (async () => {
        await ensureTables();
        return listMemberships();
      })()
    : [];

  const monthly = memberships.filter((m) => m.plan === "monthly");
  const quarterly = memberships.filter((m) => m.plan === "quarterly");

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Members</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        Monthly and quarterly members with an active subscription.
      </p>
      <AdminNav active="members" />

      {!process.env.POSTGRES_URL ? (
        <p>Database is not configured.</p>
      ) : (
        <>
          <MembersTable title="Monthly members" members={monthly} />
          <MembersTable title="Quarterly members" members={quarterly} />
        </>
      )}
    </div>
  );
}
