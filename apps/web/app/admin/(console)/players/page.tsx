import Form from "next/form";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { formatNz } from "@/components/admin/ui";
import { Badge, EmptyState, InfoDisclosure, Notice, PageHeader, Section, Tabs, kit } from "@/components/admin/kit";
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
import { MergeError, mergeMembers, type MergeResult } from "@/lib/player-merge";
import { clubShortName } from "@/lib/club-brand";

export const dynamic = "force-dynamic";

// Each action comes back to the tab it was started from.
function back(param: "toast" | "toastError", message: string, tab: "tools" | "checkins" | "" = "tools"): never {
  redirect(`/admin/players?${tab ? `tab=${tab}&` : ""}${param}=${encodeURIComponent(message)}`);
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
  if (!/^\S+@\S+\.\S+$/.test(newEmail)) back("toastError", "Enter a valid email.", "");
  const player = await getPlayerById(playerId);
  if (!player) back("toastError", "Player not found.", "");
  let result: { oldEmail: string; newEmail: string };
  try {
    result = await changePlayerEmail(playerId, newEmail);
  } catch (err) {
    back("toastError", (err as Error).message, "");
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
    back("toastError", `Email changed on the site, but Stripe couldn't be updated: ${(err as Error).message}`, "");
  }
  revalidatePath("/admin/players");
  back("toast", `Email changed to ${result.newEmail} (site and Stripe).`, "");
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
  redirect(`/admin/players?tab=tools&mergeKeep=${encodeURIComponent(keep)}&mergeDupe=${encodeURIComponent(merge)}#merge`);
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
  back("toast", ok ? `Confirmed ${email} on ${date}.` : `Removed ${email}'s check-in for ${date}.`, "checkins");
}

type Tab = "directory" | "tools" | "checkins";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; import?: string; mergeKeep?: string; mergeDupe?: string }>;
}) {
  const { q, tab: tabParam, import: showImport, mergeKeep, mergeDupe } = await searchParams;
  const tab: Tab = tabParam === "tools" || tabParam === "checkins" ? tabParam : showImport || mergeKeep ? "tools" : "directory";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title="Players" />
        <EmptyState>Database is not configured.</EmptyState>
      </div>
    );
  }
  const [players, allPlayers, checkIns] = await Promise.all([
    listPlayersForAdmin(q),
    q ? listPlayersForAdmin() : Promise.resolve(null),
    listUnverifiedAttendance(),
  ]);
  const everyone = allPlayers ?? players;
  const installed = everyone.filter((p) => p.installedAt).length;
  const signedIn = everyone.filter((p) => p.claimedAt).length;
  const tabHref = (t: Tab) => (t === "directory" ? "/admin/players" : `/admin/players?tab=${t}`);

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Players"
        subtitle={`Everyone with a player account: ${everyone.length} in total, ${signedIn} signed in at least once, ${installed} added the app to their home screen. Memberships and payments are on the Members page.`}
      />
      <Tabs
        label="Players"
        current={tab}
        items={[
          { key: "directory", label: "Directory", href: tabHref("directory"), count: everyone.length },
          { key: "tools", label: "Account tools", href: tabHref("tools") },
          { key: "checkins", label: "App check-ins", href: tabHref("checkins"), count: checkIns.length },
        ]}
      />
      {tab === "directory" && <Directory players={players} q={q} />}
      {tab === "tools" && <Tools showImport={Boolean(showImport)} mergeKeep={mergeKeep} mergeDupe={mergeDupe} players={everyone} />}
      {tab === "checkins" && <CheckIns checkIns={checkIns} />}
    </div>
  );
}

function Directory({ players, q }: { players: Awaited<ReturnType<typeof listPlayersForAdmin>>; q?: string }) {
  return (
    <>
      <Form action="/admin/players" className={kit.toolbar}>
        <label className={kit.srOnly} htmlFor="player-search">
          Search players
        </label>
        <input id="player-search" name="q" type="search" defaultValue={q ?? ""} placeholder="Search by name or email" className={kit.input} style={{ flex: "1 1 260px", maxWidth: 420 }} />
        <SubmitButton className={kit.btnSecondary} loadingText="Searching…">
          Search
        </SubmitButton>
        {q && (
          <AdminLink href="/admin/players" className={kit.btnSecondary}>
            Clear
          </AdminLink>
        )}
      </Form>
      {players.length === 0 ? (
        <EmptyState>{q ? `No player matches “${q}”.` : "No player accounts yet. Create them under Account tools."}</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>Players</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Membership</th>
                <th scope="col">Account</th>
                <th scope="col">Phone</th>
                <th scope="col">
                  <span className={kit.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td data-label="Player">
                    <div>
                      <strong>
                        {p.firstName} {p.lastName}
                      </strong>
                      <span className={kit.sub}>{p.email}</span>
                      {p.displayName && <span className={kit.sub}>Shown as {p.displayName}</span>}
                    </div>
                  </td>
                  <td data-label="Membership">
                    {p.activeMembership ? (
                      p.activeMembership
                        .split(" · ")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" · ")
                    ) : (
                      <span className={kit.muted}>None</span>
                    )}
                  </td>
                  <td data-label="Account">
                    <div>
                      {p.claimedAt ? <Badge tone="good">Signed in since {formatNz(p.claimedAt)}</Badge> : <Badge tone="warn">Never signed in</Badge>}
                      {p.installedAt && <span className={kit.sub}>📱 App on home screen</span>}
                      {!p.leaderboardVisible && <span className={kit.sub}>Hidden from the leaderboard</span>}
                      {p.welcomeSentAt && <span className={kit.sub}>Welcome email sent {formatNz(p.welcomeSentAt)}</span>}
                    </div>
                  </td>
                  <td data-label="Phone">
                    <div>
                      {p.phone ?? <span className={kit.muted}>—</span>}
                      {p.phone && <span className={kit.sub}>{p.phoneVerified ? "Confirmed" : "Not confirmed"}</span>}
                    </div>
                  </td>
                  <td data-label="">
                    <div className={kit.rowActions}>
                      <AdminLink href={`/admin/inbox?to=${encodeURIComponent(p.email)}#new`} className={kit.btnSecondary}>
                        Message
                      </AdminLink>
                      <details className={kit.inlineEdit}>
                        <summary className={kit.btnSecondary}>Change email</summary>
                        <form action={changeEmail.bind(null, p.id)} className={kit.rowActions}>
                          <input name="email" type="email" placeholder="new@email.com" required className={kit.input} aria-label={`New email for ${p.firstName}`} />
                          <SubmitButton className={kit.btn} loadingText="Saving…" confirmMessage={`Change ${p.email} to the new email everywhere, including Stripe?`}>
                            Save
                          </SubmitButton>
                        </form>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Tools({
  showImport,
  mergeKeep,
  mergeDupe,
  players,
}: {
  showImport: boolean;
  mergeKeep?: string;
  mergeDupe?: string;
  players: Awaited<ReturnType<typeof listPlayersForAdmin>>;
}) {
  const [candidates, welcomePending, sms, backfill, nameMatches] = await Promise.all([
    showImport ? previewMemberImport() : Promise.resolve(null),
    countWelcomePending(),
    getSmsUsage(),
    getStatsBackfillPreview(),
    listMinigameNameMatches(),
  ]);
  // Merge preview: the same statements as the merge, rolled back.
  let mergePreview: MergeResult | { error: string } | null = null;
  if (mergeKeep && mergeDupe) {
    try {
      mergePreview = await mergeMembers(mergeKeep, mergeDupe, false);
    } catch (err) {
      mergePreview = { error: err instanceof MergeError ? err.message : `Preview failed: ${(err as Error).message}` };
    }
  }
  const unlinked = nameMatches.filter((m) => !m.playerId).length;

  return (
    <>
      <Section title="Merge duplicate accounts" id="merge">
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          For someone with two emails (a typo, a second account). Everything moves to the email you keep, including memberships, bookings, play days, Arena
          results, shop orders, photos, messages and the Stripe customer email. Preview first: it shows exactly what will move and changes nothing.
        </p>
        <form action={previewMerge} className={kit.formGrid}>
          <label className={kit.field}>
            Duplicate email (goes away)
            <input name="merge" type="email" required defaultValue={mergeDupe ?? ""} className={kit.input} />
          </label>
          <label className={kit.field}>
            Email to keep
            <input name="keep" type="email" required defaultValue={mergeKeep ?? ""} className={kit.input} />
          </label>
          <div>
            <SubmitButton className={kit.btnSecondary} loadingText="Checking…">
              Preview merge
            </SubmitButton>
          </div>
        </form>
        {mergePreview && "error" in mergePreview ? (
          <div style={{ marginTop: 12 }}>
            <Notice tone="error">{mergePreview.error}</Notice>
          </div>
        ) : mergePreview ? (
          <div style={{ marginTop: 12, fontSize: 14 }}>
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
              <p className={kit.muted}>Nothing to move apart from the account itself.</p>
            )}
            {mergePreview.notes.map((n) => (
              <p key={n} className={kit.muted} style={{ margin: "0 0 4px" }}>
                {n}
              </p>
            ))}
            <form action={applyMerge.bind(null, mergePreview.keepEmail, mergePreview.mergeEmail)} style={{ marginTop: 8 }}>
              <SubmitButton className={kit.btn} loadingText="Merging…" confirmMessage={`Merge ${mergePreview.mergeEmail} into ${mergePreview.keepEmail}? This can't be undone.`}>
                Merge now
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </Section>

      <Section title="Points and round robin names">
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          Points update by themselves every hour. Link each round robin name to a player so their wins count
          {unlinked ? ` (${unlinked} not linked yet)` : ""}, then recalculate if something looks off.
        </p>
        <InfoDisclosure summary="How play days are counted">
          <p>
            Play days count automatically from each day&apos;s sign-up list (the day after): casual bookings and members, minus &ldquo;Can&apos;t make it&rdquo;,
            with stand-ins counted instead. Saved court boards ({backfill.boardDays} day{backfill.boardDays === 1 ? "" : "s"}) and round robin draws (
            {backfill.draws}) add anyone who played without signing up.
          </p>
          <p>Recalculating rebuilds everyone&apos;s points and ranks from scratch: nothing is counted twice, and attendance you removed stays removed.</p>
        </InfoDisclosure>
        <form action={backfillStats} style={{ marginBottom: 14 }}>
          <SubmitButton className={kit.btnSecondary} loadingText="Recalculating…">
            Recalculate everyone&apos;s points
          </SubmitButton>
        </form>
        {nameMatches.length === 0 ? (
          <EmptyState>No round robin names yet.</EmptyState>
        ) : (
          <div className={kit.tableWrap}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>Round robin names</caption>
              <thead>
                <tr>
                  <th scope="col">Round robin name</th>
                  <th scope="col">Player account</th>
                </tr>
              </thead>
              <tbody>
                {nameMatches.map((m) => (
                  <tr key={m.name}>
                    <td data-label="Round robin name">
                      <strong>{m.name}</strong> {!m.playerId && <Badge tone="warn">Not linked</Badge>}
                    </td>
                    <td data-label="Player account">
                      <form action={saveMinigameName} className={kit.rowActions}>
                        <input type="hidden" name="name" value={m.name} />
                        <select name="playerId" defaultValue={m.playerId ?? ""} className={kit.select} aria-label={`Player for ${m.name}`}>
                          <option value="">Not linked</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.firstName} {p.lastName} ({p.email})
                            </option>
                          ))}
                        </select>
                        <SubmitButton className={kit.btnSecondary} loadingText="Saving…">
                          Save
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Create accounts for members">
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          Gives every member with an active membership a player account, using the email on their membership. Safe to run again: it only adds missing
          accounts and never changes details a player has edited.
        </p>
        <div className={kit.rowActions}>
          <AdminLink href="/admin/players?tab=tools&import=1" className={kit.btnSecondary}>
            Preview
          </AdminLink>
          <form action={importMembers}>
            <SubmitButton className={kit.btn} loadingText="Creating…" confirmMessage="Create accounts for every active member who doesn't have one?">
              Create accounts
            </SubmitButton>
          </form>
        </div>
        {candidates && (
          <div className={kit.tableWrap} style={{ marginTop: 14 }}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>Accounts to create</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Membership</th>
                  <th scope="col">Account</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.email}>
                    <td data-label="Member">
                      <div>
                        {c.firstName} {c.lastName}
                        <span className={kit.sub}>{c.email}</span>
                      </div>
                    </td>
                    <td data-label="Membership">{c.plans.join(", ")}</td>
                    <td data-label="Account">
                      <div className={kit.rowActions}>
                        {c.hasAccount ? <Badge tone="good">Has an account</Badge> : <Badge tone="warn">Will be created</Badge>}
                        {c.nearDuplicates.length > 0 && <Badge tone="bad">Possible duplicate of {c.nearDuplicates.join(", ")}</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Welcome emails">
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          {welcomePending} member{welcomePending === 1 ? "" : "s"} still to welcome. The launch email (&ldquo;Your {clubShortName()} profile is here&rdquo;) greets
          each member by name with a sign-in button. Each click sends up to {WELCOME_BATCH}, to stay under the free limit of 100 emails a day.
        </p>
        <div className={kit.rowActions}>
          <form action={previewWelcome}>
            <SubmitButton className={kit.btnSecondary} loadingText="Sending…">
              Send me a preview
            </SubmitButton>
          </form>
          <form action={sendWelcome}>
            <SubmitButton
              className={kit.btn}
              loadingText="Sending…"
              disabled={welcomePending === 0}
              confirmMessage={`Send welcome emails to up to ${Math.min(welcomePending, WELCOME_BATCH)} members?`}
            >
              Send welcome emails
            </SubmitButton>
          </form>
        </div>
      </Section>

      <Section title="Sign-in by text message">
        <p style={{ fontSize: 14, margin: "-4px 0 6px" }}>
          Texts in the last 24 hours: <strong>{sms.used} of {sms.limit}</strong> free
          {sms.nextSlotAt && <> · next free text from {formatNz(sms.nextSlotAt, true)}</>}
        </p>
        <p className={kit.muted} style={{ fontSize: 13 }}>
          {!sms.configured
            ? "Not set up yet (see System check). Until then players sign in by email."
            : !sms.switchedOn
              ? "Switched off: players only see email sign-in."
              : sms.available
                ? "On. When the free texts run out, players get email sign-in until one frees up, so texts never cost money."
                : "Free texts used up for now: players see email sign-in only."}
        </p>
        {sms.configured && (
          <form action={toggleSms.bind(null, !sms.switchedOn)}>
            <SubmitButton className={kit.btnSecondary} loadingText="Saving…">
              {sms.switchedOn ? "Turn text sign-in off" : "Turn text sign-in on"}
            </SubmitButton>
          </form>
        )}
      </Section>
    </>
  );
}

function CheckIns({ checkIns }: { checkIns: Awaited<ReturnType<typeof listUnverifiedAttendance>> }) {
  return (
    <>
      <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
        Play days sent in by a player&apos;s connected app. They only count once you confirm them.
      </p>
      {checkIns.length === 0 ? (
        <EmptyState>Nothing to confirm.</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>Check-ins to confirm</caption>
            <thead>
              <tr>
                <th scope="col">Play day</th>
                <th scope="col">Player</th>
                <th scope="col">
                  <span className={kit.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {checkIns.map((c) => (
                <tr key={`${c.date}-${c.email}`}>
                  <td data-label="Play day">{formatNz(`${c.date}T12:00:00Z`)}</td>
                  <td data-label="Player">{c.email}</td>
                  <td data-label="">
                    <div className={kit.rowActions}>
                      <form action={confirmCheckIn.bind(null, c.date, c.email, true)}>
                        <SubmitButton className={kit.btn} loadingText="Saving…">
                          Confirm
                        </SubmitButton>
                      </form>
                      <form action={confirmCheckIn.bind(null, c.date, c.email, false)}>
                        <SubmitButton className={kit.btnSecondary} loadingText="Saving…" confirmMessage={`Reject ${c.email}'s check-in?`}>
                          Reject
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
