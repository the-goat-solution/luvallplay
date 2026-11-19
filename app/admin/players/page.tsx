import Form from "next/form";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminLink } from "@/components/admin/AdminLink";
import { AdminToastBridge } from "@/components/admin/AdminToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnSecondary, card, formatNz, input, pill, td, th } from "@/components/admin/ui";
import {
  changePlayerEmail,
  countWelcomePending,
  getPlayerById,
  listPlayersForAdmin,
  previewMemberImport,
  runMemberImport,
} from "@/lib/player-db";
import { getSmsUsage, setSmsSwitch } from "@/lib/sms";
import { WELCOME_BATCH, sendWelcomeBatch, sendWelcomePreview } from "@/lib/welcome-emails";
import { adminAlertRecipients } from "@/lib/player-email";
import { getStripe } from "@/lib/stripe";
import { confirmAttendance, getStatsBackfillPreview, listMinigameNameMatches, listUnverifiedAttendance, removeAttendance, setMinigameName } from "@/lib/stats-db";
import { recalculateAllPoints } from "@/lib/arena-db";
import { listRecentFeedback } from "@/lib/membership-self-service";
import { MergeError, mergeMembers, type MergeResult } from "@/lib/player-merge";

export const dynamic = "force-dynamic";

function back(param: "toast" | "toastError", message: string, extra = ""): never {
  redirect(`/admin/players?${param}=${encodeURIComponent(message)}${extra}`);
}

async function importMembers() {
  "use server";
  const { created, existing } = await runMemberImport();
  revalidatePath("/admin/players");
  back("toast", `Created ${created} account${created === 1 ? "" : "s"}; ${existing} already had one.`);
}

async function sendWelcome() {
  "use server";
  const { sent, failed } = await sendWelcomeBatch();
  revalidatePath("/admin/players");
  if (failed > 0) back("toastError", `Sent ${sent} welcome email${sent === 1 ? "" : "s"}; ${failed} failed and will be retried next time.`);
  back("toast", `Sent ${sent} welcome email${sent === 1 ? "" : "s"}.`);
}

async function previewWelcome() {
  "use server";
  const to = adminAlertRecipients()[0];
  await sendWelcomePreview(to);
  back("toast", `Preview sent to ${to}.`);
}

async function toggleSms(on: boolean) {
  "use server";
  await setSmsSwitch(on);
  revalidatePath("/admin/players");
  back("toast", on ? "SMS sign-in switched on (within the free limit)." : "SMS sign-in switched off. Players see email sign-in only.");
}

async function changeEmail(playerId: number, formData: FormData) {
  "use server";
  const newEmail = String(formData.get("email") ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(newEmail)) back("toastError", "Enter a valid email.");
  const player = await getPlayerById(playerId);
  if (!player) back("toastError", "Player not found.");
  let result: { oldEmail: string; newEmail: string };
  try {
    result = await changePlayerEmail(playerId, newEmail);
  } catch (err) {
    back("toastError", (err as Error).message);
  }
  // Keep Stripe's customer email in step: receipts and renewal emails go there.
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe();
      const ids = new Set<string>();
      if (player.stripeCustomerId) ids.add(player.stripeCustomerId);
      const found = await stripe.customers.list({ email: result.oldEmail, limit: 10 });
      found.data.forEach((c) => ids.add(c.id));
      for (const id of ids) await stripe.customers.update(id, { email: result.newEmail });
    }
  } catch (err) {
    console.error("[players] Stripe email update failed:", err);
    back("toastError", `Email changed on the site, but Stripe couldn't be updated: ${(err as Error).message}`);
  }
  revalidatePath("/admin/players");
  back("toast", `Email changed to ${result.newEmail} (site and Stripe).`);
}

async function backfillStats() {
  "use server";
  const r = await recalculateAllPoints();
  revalidatePath("/admin/players");
  back("toast", `Points recalculated: ${r.attendance} play days added, ${r.roundRobin} round robin results re-read, ${r.players} rank${r.players === 1 ? "" : "s"} corrected.`);
}

async function previewMerge(formData: FormData) {
  "use server";
  const keep = String(formData.get("keep") ?? "").trim();
  const merge = String(formData.get("merge") ?? "").trim();
  redirect(`/admin/players?mergeKeep=${encodeURIComponent(keep)}&mergeDupe=${encodeURIComponent(merge)}#merge`);
}

async function applyMerge(keep: string, merge: string) {
  "use server";
  let result: MergeResult;
  try {
    result = await mergeMembers(keep, merge, true);
  } catch (err) {
    back("toastError", err instanceof MergeError ? err.message : `Merge failed, nothing was changed: ${(err as Error).message}`);
  }
  // Stripe receipts and renewals go to the customer's email: move those too.
  let stripeNote = "";
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe();
      const found = await stripe.customers.list({ email: result.mergeEmail, limit: 10 });
      for (const c of found.data) await stripe.customers.update(c.id, { email: result.keepEmail });
      if (found.data.length) stripeNote = ` Stripe updated (${found.data.length} customer${found.data.length === 1 ? "" : "s"}).`;
    }
  } catch (err) {
    console.error("[players] merge: Stripe email update failed:", err);
    stripeNote = ` Stripe could not be updated (${(err as Error).message}); change the email there by hand.`;
  }
  await recalculateAllPoints().catch((err) => console.error("[players] merge: recalculation failed:", err));
  revalidatePath("/admin/players");
  back("toast", `Merged ${result.mergeEmail} into ${result.keepEmail}; points recalculated.${stripeNote}`);
}

async function saveMinigameName(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "");
  const playerId = Number(formData.get("playerId"));
  try {
    await setMinigameName(name, Number.isInteger(playerId) && playerId > 0 ? playerId : null);
  } catch (err) {
    back("toastError", (err as Error).message);
  }
  revalidatePath("/admin/players");
  back("toast", `Saved ${name}.`);
}

async function confirmCheckIn(date: string, email: string, ok: boolean) {
  "use server";
  if (ok) await confirmAttendance(date, email);
  else await removeAttendance(date, email);
  revalidatePath("/admin/players");
  back("toast", ok ? `Confirmed ${email} on ${date}.` : `Removed ${email}'s check-in for ${date}.`);
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; import?: string; mergeKeep?: string; mergeDupe?: string }>;
}) {
  const { q, import: showImport, mergeKeep, mergeDupe } = await searchParams;
  const hasDb = Boolean(process.env.POSTGRES_URL);
  if (!hasDb) {
    return (
      <div className={adminStyles.page}>
        <h1 className={adminStyles.title}>Players</h1>
        <AdminNav active="players" />
        <p>Database is not configured.</p>
      </div>
    );
  }
  const [players, candidates, welcomePending, sms, backfill, nameMatches, checkIns, feedback] = await Promise.all([
    listPlayersForAdmin(q),
    showImport ? previewMemberImport() : Promise.resolve(null),
    countWelcomePending(),
    getSmsUsage(),
    getStatsBackfillPreview(),
    listMinigameNameMatches(),
    listUnverifiedAttendance(),
    listRecentFeedback(15),
  ]);
  const allPlayers = q ? await listPlayersForAdmin() : players;
  // Merge preview: the same statements as the merge, rolled back.
  let mergePreview: MergeResult | { error: string } | null = null;
  if (mergeKeep && mergeDupe) {
    try {
      mergePreview = await mergeMembers(mergeKeep, mergeDupe, false);
    } catch (err) {
      mergePreview = { error: err instanceof MergeError ? err.message : `Preview failed: ${(err as Error).message}` };
    }
  }
  const installed = allPlayers.filter((p) => p.installedAt).length;
  const signedIn = allPlayers.filter((p) => p.claimedAt).length;

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Players</h1>
      <p className={adminStyles.subtitle}>
        Player accounts: {allPlayers.length} in total, {signedIn} signed in at least once, {installed} added the app to their home screen.
      </p>
      <AdminNav active="players" />
      <AdminToastBridge />
      <p style={{ marginTop: 0, fontSize: 13 }}>
        <AdminLink href="/admin/setup">Setup check →</AdminLink>
      </p>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>1. Accounts for current members</h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          Creates an account for every member whose membership is active now, using the email on their membership. Safe to run again: it only
          adds members who don&apos;t have an account yet and never changes details a player has edited.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <AdminLink href="/admin/players?import=1" style={{ ...btnSecondary, textDecoration: "none" }}>
            Preview import
          </AdminLink>
          <form action={importMembers}>
            <SubmitButton loadingText="Creating…" style={btn} confirmMessage="Create accounts for every active member who doesn't have one?">
              Create accounts
            </SubmitButton>
          </form>
        </div>
        {candidates && (
          <div className={adminStyles.tableWrap} style={{ marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={th}>Member</th>
                  <th style={th}>Email</th>
                  <th style={th}>Membership</th>
                  <th style={th}>Account</th>
                  <th style={th}>Check</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.email} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={td}>
                      {c.firstName} {c.lastName}
                    </td>
                    <td style={td}>{c.email}</td>
                    <td style={td}>{c.plans.join(", ")}</td>
                    <td style={td}>{c.hasAccount ? <span style={pill("#e9f6ee", "#1d6b3d")}>Has account</span> : <span style={pill("#fff4e5", "#8a4b00")}>Will be created</span>}</td>
                    <td style={td}>
                      {c.nearDuplicates.length > 0 && (
                        <span style={pill("#fdecec", "#a12a2a")} title="Same inbox written differently">
                          Possible duplicate of {c.nearDuplicates.join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>2. Play days and points</h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          Play days count automatically from each day&apos;s sign-up list (the day after): casual bookings and members, minus &ldquo;Can&apos;t make it&rdquo;,
          with fill-ins counted instead. No check-in needed. Saved court boards ({backfill.boardDays} day{backfill.boardDays === 1 ? "" : "s"}) and round robin
          draws ({backfill.draws}) add anyone who played without signing up. This keeps itself up to date hourly; the button recalculates everyone&apos;s
          points and ranks from scratch (nothing is counted twice, and attendance you removed stays removed). Match the mini game names below first so
          round robin results reach the right people.
        </p>
        <form action={backfillStats}>
          <SubmitButton loadingText="Recalculating…" style={btn}>
            Recalculate everyone&apos;s points
          </SubmitButton>
        </form>

        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Mini game names → players</h3>
        <div className={adminStyles.tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd" }}>
                <th style={th}>Mini game name</th>
                <th style={th}>Player account</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {nameMatches.map((m) => (
                <tr key={m.name} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={td}>
                    <strong>{m.name}</strong>
                  </td>
                  <td style={td} colSpan={2}>
                    <form action={saveMinigameName} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="name" value={m.name} />
                      <select name="playerId" defaultValue={m.playerId ?? ""} style={input}>
                        <option value="">— not linked —</option>
                        {allPlayers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.firstName} {p.lastName} ({p.email})
                          </option>
                        ))}
                      </select>
                      <SubmitButton loadingText="Saving…" style={btnSecondary}>
                        Save
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={card} id="merge">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Merge a duplicate member</h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          For a member with two emails (a typo, a second account). Everything under the duplicate moves to the email you keep: memberships, bookings,
          sign-ups, play days, round robin results, Arena pairs and challenges, Wolf Vision, shop orders, photos and messages, and the Stripe customer email.
          The duplicate account is retired and points are recalculated. Preview first: it shows exactly what will move and changes nothing.
        </p>
        <form action={previewMerge} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input name="merge" type="email" required placeholder="Duplicate email (goes away)" defaultValue={mergeDupe ?? ""} style={{ ...input, minWidth: 240 }} />
          <span aria-hidden="true">→</span>
          <input name="keep" type="email" required placeholder="Email to keep" defaultValue={mergeKeep ?? ""} style={{ ...input, minWidth: 240 }} />
          <SubmitButton loadingText="Checking…" style={btnSecondary}>
            Preview merge
          </SubmitButton>
        </form>
        {mergePreview && "error" in mergePreview ? (
          <p style={{ ...pill("#fdecec", "#a12a2a"), display: "block", marginTop: 12, padding: "8px 10px" }}>{mergePreview.error}</p>
        ) : mergePreview ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <p style={{ margin: "0 0 6px" }}>
              <strong>{mergePreview.mergeEmail}</strong>
              {mergePreview.mergeName ? ` (${mergePreview.mergeName})` : " (no account)"} → <strong>{mergePreview.keepEmail}</strong>
              {mergePreview.keepName ? ` (${mergePreview.keepName})` : " (no account)"}
            </p>
            {mergePreview.moved.length ? (
              <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                {mergePreview.moved.map((m) => (
                  <li key={m.label}>
                    {m.n} {m.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "0 0 6px", color: "#666" }}>No records to move (only the account itself).</p>
            )}
            {mergePreview.notes.map((n) => (
              <p key={n} style={{ margin: "0 0 4px", color: "#555" }}>
                {n}
              </p>
            ))}
            <form action={applyMerge.bind(null, mergePreview.keepEmail, mergePreview.mergeEmail)} style={{ marginTop: 8 }}>
              <SubmitButton
                loadingText="Merging…"
                style={btn}
                confirmMessage={`Merge ${mergePreview.mergeEmail} into ${mergePreview.keepEmail}? This can't be undone.`}
              >
                Merge now
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>3. Welcome emails</h2>
        <p style={{ color: "#666", fontSize: 13 }}>
          {welcomePending} imported member{welcomePending === 1 ? "" : "s"} still to email. Each click sends up to {WELCOME_BATCH}, to stay under the free limit of
          100 emails a day. It&apos;s the launch email (“Your Three Wolves profile is here”), greeting each member by name, with a sign-in button that fills in their email and a one-click link to hide from the leaderboard.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={previewWelcome}>
            <SubmitButton loadingText="Sending…" style={btnSecondary}>
              Send me a preview
            </SubmitButton>
          </form>
          <form action={sendWelcome}>
            <SubmitButton
              loadingText="Sending…"
              style={btn}
              disabled={welcomePending === 0}
              confirmMessage={`Send welcome emails to up to ${Math.min(welcomePending, WELCOME_BATCH)} members?`}
            >
              Send welcome emails
            </SubmitButton>
          </form>
        </div>
      </section>

      {checkIns.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Check-ins from connected apps ({checkIns.length})</h2>
          <p style={{ color: "#666", fontSize: 13 }}>Play days sent in by a player&apos;s connected app. They only count once you confirm them.</p>
          {checkIns.map((c) => (
            <div key={`${c.date}-${c.email}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid #eee", fontSize: 13 }}>
              <span style={{ flex: 1 }}>
                <strong>{c.date}</strong> · {c.email}
              </span>
              <form action={confirmCheckIn.bind(null, c.date, c.email, true)}>
                <SubmitButton loadingText="…" style={btn}>
                  Confirm
                </SubmitButton>
              </form>
              <form action={confirmCheckIn.bind(null, c.date, c.email, false)}>
                <SubmitButton loadingText="…" style={btnSecondary}>
                  Reject
                </SubmitButton>
              </form>
            </div>
          ))}
        </section>
      )}

      {feedback.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Why members are leaving or downgrading</h2>
          {feedback.map((f, i) => (
            <div key={i} style={{ padding: "6px 0", borderTop: "1px solid #eee", fontSize: 13 }}>
              <strong>{f.name || f.email}</strong> · {f.action === "cancel" ? "turned off auto-renew" : "switched to Monthly"} · {formatNz(f.createdAt)}
              <div style={{ color: "#555" }}>
                Reason: {f.reason}
                {f.comment ? ` — “${f.comment}”` : ""}
              </div>
            </div>
          ))}
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>SMS sign-in</h2>
        <p style={{ fontSize: 14, margin: "0 0 6px" }}>
          Texts in the last 24 hours: <strong>{sms.used} / {sms.limit}</strong>
          {sms.nextSlotAt && <> · next free text from {formatNz(sms.nextSlotAt, true)}</>}
        </p>
        <p style={{ color: "#666", fontSize: 13 }}>
          {!sms.configured
            ? "Not set up: add FIREBASE_API_KEY to turn on SMS codes. Until then players sign in by email."
            : !sms.switchedOn
              ? "Switched off: players only see email sign-in."
              : sms.available
                ? "On. Once the free texts are used up, the website only offers email sign-in until one frees up, so texts never cost money."
                : "Free texts used up for now: the website is showing email sign-in only."}
        </p>
        {sms.configured && (
          <form action={toggleSms.bind(null, !sms.switchedOn)}>
            <SubmitButton loadingText="Saving…" style={btnSecondary}>
              {sms.switchedOn ? "Turn SMS sign-in off" : "Turn SMS sign-in on"}
            </SubmitButton>
          </form>
        )}
      </section>

      <section style={card}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>All players</h2>
          <Form action="/admin/players" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <input name="q" defaultValue={q ?? ""} placeholder="Search name or email" style={input} />
            <SubmitButton loadingText="Searching…" style={btnSecondary}>
              Search
            </SubmitButton>
          </Form>
        </div>
        <div className={adminStyles.tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd" }}>
                <th style={th}>Player</th>
                <th style={th}>Membership</th>
                <th style={th}>Account</th>
                <th style={th}>Phone</th>
                <th style={th}>Change email</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "#888" }}>
                    No player accounts yet. Use “Create accounts” above.
                  </td>
                </tr>
              ) : (
                players.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={td}>
                      <strong>
                        {p.firstName} {p.lastName}
                      </strong>
                      <div style={{ color: "#666" }}>{p.email}</div>
                      {p.displayName && <div style={{ color: "#888", fontSize: 12 }}>Shown as {p.displayName}</div>}
                    </td>
                    <td style={td}>{p.activeMembership ?? <span style={{ color: "#888" }}>—</span>}</td>
                    <td style={td}>
                      {p.claimedAt ? (
                        <span style={pill("#e9f6ee", "#1d6b3d")}>Active since {formatNz(p.claimedAt)}</span>
                      ) : (
                        <span style={pill("#fff4e5", "#8a4b00")}>Not signed in yet</span>
                      )}
                      {p.installedAt && <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>📱 App installed</div>}
                      {!p.leaderboardVisible && <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Hidden from leaderboard</div>}
                      {p.welcomeSentAt && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Welcome sent {formatNz(p.welcomeSentAt)}</div>}
                    </td>
                    <td style={td}>
                      {p.phone ?? "—"}
                      {p.phone && <div style={{ fontSize: 12, color: p.phoneVerified ? "#1d6b3d" : "#888" }}>{p.phoneVerified ? "Confirmed" : "Not confirmed"}</div>}
                    </td>
                    <td style={td}>
                      <form action={changeEmail.bind(null, p.id)} style={{ display: "flex", gap: 6 }}>
                        <input name="email" type="email" placeholder="new@email.com" required style={{ ...input, width: 170 }} />
                        <SubmitButton
                          loadingText="…"
                          style={btnSecondary}
                          confirmMessage={`Change ${p.email}'s email everywhere, including Stripe?`}
                        >
                          Change
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ fontSize: 13, color: "#666" }}>
        Setting up? <AdminLink href="/admin/setup">Setup check</AdminLink> tests email, Stripe, photo storage, the safety check and SMS live.
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        Testing on a new phone, tablet or foldable? Open <AdminLink href="/admin/device-check">Screen check</AdminLink> on it to see the sizes the website gets.
      </p>
    </div>
  );
}
