import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { AdminNav } from "@/components/admin/AdminNav";
import adminStyles from "@/components/admin/admin.module.css";
import { JerseyExport } from "@/components/admin/JerseyExport";
import { JerseyToastBridge } from "@/components/admin/JerseyToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { sendJerseyPaidEmail } from "@/lib/email";
import {
  EARLY_BIRD_LIMIT,
  FLAG_LABEL,
  JERSEY_SIZES,
  formatDollars,
  jerseyClosesAt,
  jerseyOpensAt,
} from "@/lib/jersey";
import {
  getJerseyRegistration,
  listJerseyRegistrations,
  markJerseyPaid,
  markJerseyUnpaid,
  setJerseyStatus,
  type JerseyRegistration,
} from "@/lib/jersey-db";

export const dynamic = "force-dynamic";

function back(param: "toast" | "toastError", message: string): never {
  redirect(`/admin/jersey?${param}=${encodeURIComponent(message)}`);
}

async function markPaid(id: number) {
  "use server";
  const reg = await getJerseyRegistration(id);
  if (!reg || !(await markJerseyPaid(id, null))) back("toastError", "That registration can't be marked paid.");
  try {
    await sendJerseyPaidEmail({
      to: reg.email,
      firstName: reg.firstName,
      refCode: reg.refCode ?? "",
      paidCents: reg.priceCents,
      priceCents: reg.priceCents,
      lang: reg.lang,
    });
  } catch (err) {
    console.error("Jersey paid email failed", err);
  }
  revalidatePath("/admin/jersey");
  back("toast", `${reg.firstName} ${reg.lastName} marked as paid.`);
}

async function markUnpaid(id: number) {
  "use server";
  const ok = await markJerseyUnpaid(id);
  revalidatePath("/admin/jersey");
  if (!ok) back("toastError", "Payments matched from the bank can't be undone here — unmatch the bank line first.");
  back("toast", "Marked as awaiting payment.");
}

async function setStatus(id: number, status: "cancelled" | "released") {
  "use server";
  await setJerseyStatus(id, status);
  revalidatePath("/admin/jersey");
  back("toast", status === "cancelled" ? "Registration cancelled." : "Spot released.");
}

const nzFull = (d: Date) =>
  new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "full", timeStyle: "short" }).format(d);

const nz = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "";

const btn = { padding: "3px 8px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", color: "#333", fontSize: 12 } as const;
const btnPrimary = { ...btn, border: "1px solid #1a2a4a", background: "#1a2a4a", color: "#fff" } as const;
const cell = { padding: "6px 8px", verticalAlign: "top" } as const;

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  paid: { bg: "#e3f4e8", fg: "#1a7a3c", label: "Paid" },
  pending: { bg: "#fff4e5", fg: "#8a4b00", label: "Awaiting payment" },
  released: { bg: "#eee", fg: "#666", label: "Released (expired)" },
  cancelled: { bg: "#eee", fg: "#666", label: "Cancelled" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: "10px 14px", minWidth: 120 }}>
      <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a" }}>{value}</div>
    </div>
  );
}

function Row({ r }: { r: JerseyRegistration }) {
  const free = r.paidBy === "free";
  const st = free ? { bg: "#e8f0fb", fg: "#1f4f8f", label: "Free" } : STATUS_STYLE[r.status];
  const live = r.status === "pending" || r.status === "paid";
  return (
    <tr style={{ borderBottom: "1px solid #eee", opacity: live ? 1 : 0.6 }}>
      <td style={{ ...cell, fontFamily: "monospace", fontWeight: 700 }}>{r.refCode ?? "—"}</td>
      <td style={cell}>
        {r.firstName} {r.lastName}
        <div style={{ color: "#666", fontSize: 12 }}>{r.email}<br />{r.phone}</div>
      </td>
      <td style={cell}>
        {r.size}
        {r.printName ? <div style={{ fontSize: 12, color: "#666" }}>{r.printName}{r.printNumber !== null ? ` #${r.printNumber}` : r.printCountry ? ` · ${r.printCountry}` : ""}</div> : null}
      </td>
      <td style={cell}>
        {free ? "Free" : formatDollars(r.priceCents)}
        {r.earlyBird ? <div style={{ fontSize: 12, color: "#9e6d1f" }}>Early bird</div> : null}
      </td>
      <td style={cell}>
        <span style={{ background: st.bg, color: st.fg, fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
          {st.label}
        </span>
        {free ? (
          <div style={{ fontSize: 12, color: "#666" }}>No payment needed · {nz(r.paidAt)}</div>
        ) : r.status === "paid" ? (
          <div style={{ fontSize: 12, color: "#666" }}>
            {r.paidCents !== null ? formatDollars(r.paidCents) : ""} · {r.paidBy === "auto" ? "bank match" : "by admin"} · {nz(r.paidAt)}
          </div>
        ) : r.status === "pending" && r.expiresAt ? (
          <div style={{ fontSize: 12, color: "#666" }}>Hold until {nz(r.expiresAt)}</div>
        ) : null}
      </td>
      <td style={{ ...cell, fontSize: 12, color: "#b45309" }}>
        {r.flags.map((f) => (
          <div key={f}>⚠ {FLAG_LABEL[f] ?? f}</div>
        ))}
      </td>
      <td style={cell}>{nz(r.createdAt)}</td>
      <td style={{ ...cell, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <AdminLink href={`/admin/jersey/${r.id}`} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            Edit
          </AdminLink>
          {r.status === "pending" || r.status === "released" ? (
            <form action={markPaid.bind(null, r.id)}>
              <SubmitButton loadingText="Saving…" style={btnPrimary} confirmMessage={`Mark ${r.firstName} ${r.lastName} as paid and email them?`}>
                Mark paid
              </SubmitButton>
            </form>
          ) : null}
          {r.status === "paid" && !free ? (
            <form action={markUnpaid.bind(null, r.id)}>
              <SubmitButton loadingText="Saving…" style={btn} confirmMessage={`Mark ${r.firstName} ${r.lastName} as NOT paid?`}>
                Undo paid
              </SubmitButton>
            </form>
          ) : null}
          {r.status === "pending" ? (
            <form action={setStatus.bind(null, r.id, "released")}>
              <SubmitButton loadingText="Saving…" style={btn} confirmMessage="Release this spot now?">Release</SubmitButton>
            </form>
          ) : null}
          {r.status === "pending" || r.status === "released" || free ? (
            <form action={setStatus.bind(null, r.id, "cancelled")}>
              <SubmitButton loadingText="Saving…" style={btn} confirmMessage={`Cancel ${r.firstName}'s registration?`}>Cancel</SubmitButton>
            </form>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default async function JerseyAdminPage() {
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const regs = hasDb ? await listJerseyRegistrations() : [];
  const live = regs.filter((r) => r.status === "pending" || r.status === "paid");
  const free = live.filter((r) => r.paidBy === "free");
  const paid = regs.filter((r) => r.status === "paid" && r.paidBy !== "free");
  const pending = regs.filter((r) => r.status === "pending");
  const early = live.filter((r) => r.earlyBird).length;
  const sum = (list: JerseyRegistration[], f: (r: JerseyRegistration) => number) => list.reduce((t, r) => t + f(r), 0);
  const received = sum(paid, (r) => r.paidCents ?? r.priceCents);
  const outstanding = sum(pending, (r) => r.priceCents);
  const flagged = live.filter((r) => r.flags.length > 0).length;

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Jersey registrations</h1>
      <p className={adminStyles.subtitle}>
        Opens {nzFull(jerseyOpensAt())}; closes {nzFull(jerseyClosesAt())}.
        Bank payments carrying a registration&apos;s 5-digit code are marked paid automatically; mark the rest paid by hand.
      </p>
      <AdminNav active="jersey" />
      <JerseyToastBridge />

      {!hasDb ? (
        <p>Database is not configured.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label="Registered" value={String(live.length)} />
            <Stat label="Early birds" value={`${early} / ${EARLY_BIRD_LIMIT}`} />
            <Stat label="Paid" value={`${paid.length} (${formatDollars(received)})`} />
            <Stat label="Free" value={String(free.length)} />
            <Stat label="Awaiting" value={`${pending.length} (${formatDollars(outstanding)})`} />
            <Stat label="Flagged" value={String(flagged)} />
          </div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>
            Sizes:{" "}
            {JERSEY_SIZES.map((s) => `${s} ${live.filter((r) => r.size === s).length}`).join(" · ")}
          </div>
          <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <AdminLink
              href="/admin/jersey/new"
              style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #1a2a4a", background: "#1a2a4a", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", display: "inline-block" }}
            >
              + Add registration
            </AdminLink>
            <JerseyExport />
          </div>

          <div className={adminStyles.tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                  {["Code", "Person", "Size", "Price", "Status", "Flags", "Registered", ""].map((h) => (
                    <th key={h} style={{ padding: "6px 8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regs.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: "10px 8px", color: "#888" }}>No registrations yet.</td></tr>
                ) : (
                  regs.map((r) => <Row key={r.id} r={r} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
