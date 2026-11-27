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
import { adminText } from "@/lib/admin-lang";

type T = Awaited<ReturnType<typeof adminText>>["t"];

export const dynamic = "force-dynamic";

// Each action comes back to the tab it was started from.
function back(param: "toast" | "toastError", message: string, tab: "tools" | "checkins" | "" = "tools"): never {
  redirect(`/admin/players?${tab ? `tab=${tab}&` : ""}${param}=${encodeURIComponent(message)}`);
}

async function importMembers() {
  "use server";
  const { t } = await adminText();
  const { created, existing } = await runMemberImport();
  revalidatePath("/admin/players");
  back("toast", t(created === 1 ? "ppl_msg_imported_one" : "ppl_msg_imported_many", { created, existing }));
}

async function sendWelcome() {
  "use server";
  const { t } = await adminText();
  const { sent, failed } = await sendWelcomeBatch();
  revalidatePath("/admin/players");
  if (failed > 0) back("toastError", t(sent === 1 ? "ppl_msg_welcome_failed_one" : "ppl_msg_welcome_failed_many", { sent, failed }));
  back("toast", t(sent === 1 ? "ppl_msg_welcome_one" : "ppl_msg_welcome_many", { sent }));
}

async function previewWelcome() {
  "use server";
  const { t } = await adminText();
  const to = adminAlertRecipients()[0];
  await sendWelcomePreview(to);
  back("toast", t("ppl_msg_preview_sent", { to }));
}

async function toggleSms(on: boolean) {
  "use server";
  const { t } = await adminText();
  await setSmsSwitch(on);
  revalidatePath("/admin/players");
  back("toast", on ? t("ppl_msg_sms_on") : t("ppl_msg_sms_off"));
}

async function changeEmail(playerId: number, formData: FormData) {
  "use server";
  const { t } = await adminText();
  const newEmail = String(formData.get("email") ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(newEmail)) back("toastError", t("ppl_err_email"), "");
  const player = await getPlayerById(playerId);
  if (!player) back("toastError", t("ppl_err_not_found"), "");
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
    back("toastError", t("ppl_err_stripe", { error: (err as Error).message }), "");
  }
  revalidatePath("/admin/players");
  back("toast", t("ppl_msg_email_changed", { email: result.newEmail }), "");
}

async function backfillStats() {
  "use server";
  const { t } = await adminText();
  const r = await recalculateAllPoints();
  revalidatePath("/admin/players");
  back("toast", t(r.players === 1 ? "ppl_msg_recalc_one" : "ppl_msg_recalc_many", { attendance: r.attendance, rr: r.roundRobin, n: r.players }));
}

async function previewMerge(formData: FormData) {
  "use server";
  const keep = String(formData.get("keep") ?? "").trim();
  const merge = String(formData.get("merge") ?? "").trim();
  redirect(`/admin/players?tab=tools&mergeKeep=${encodeURIComponent(keep)}&mergeDupe=${encodeURIComponent(merge)}#merge`);
}

async function applyMerge(keep: string, merge: string) {
  "use server";
  const { t } = await adminText();
  let result: MergeResult;
  try {
    result = await mergeMembers(keep, merge, true);
  } catch (err) {
    back("toastError", err instanceof MergeError ? err.message : t("ppl_err_merge_failed", { error: (err as Error).message }));
  }
  // Stripe receipts and renewals go to the customer's email: move those too.
  let stripeNote = "";
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe();
      const found = await stripe.customers.list({ email: result.mergeEmail, limit: 10 });
      for (const c of found.data) await stripe.customers.update(c.id, { email: result.keepEmail });
      if (found.data.length) stripeNote = t(found.data.length === 1 ? "ppl_note_stripe_updated_one" : "ppl_note_stripe_updated_many", { n: found.data.length });
    }
  } catch (err) {
    console.error("[players] merge: Stripe email update failed:", err);
    stripeNote = t("ppl_note_stripe_failed", { error: (err as Error).message });
  }
  await recalculateAllPoints().catch((err) => console.error("[players] merge: recalculation failed:", err));
  revalidatePath("/admin/players");
  back("toast", t("ppl_msg_merged", { from: result.mergeEmail, to: result.keepEmail, note: stripeNote }));
}

async function saveMinigameName(formData: FormData) {
  "use server";
  const { t } = await adminText();
  const name = String(formData.get("name") ?? "");
  const playerId = Number(formData.get("playerId"));
  try {
    await setMinigameName(name, Number.isInteger(playerId) && playerId > 0 ? playerId : null);
  } catch (err) {
    back("toastError", (err as Error).message);
  }
  revalidatePath("/admin/players");
  back("toast", t("ppl_msg_saved_name", { name }));
}

async function confirmCheckIn(date: string, email: string, ok: boolean) {
  "use server";
  const { t } = await adminText();
  if (ok) await confirmAttendance(date, email);
  else await removeAttendance(date, email);
  revalidatePath("/admin/players");
  back("toast", ok ? t("ppl_msg_confirmed", { email, date }) : t("ppl_msg_rejected", { email, date }), "checkins");
}

type Tab = "directory" | "tools" | "checkins";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; import?: string; mergeKeep?: string; mergeDupe?: string }>;
}) {
  const { t } = await adminText();
  const { q, tab: tabParam, import: showImport, mergeKeep, mergeDupe } = await searchParams;
  const tab: Tab = tabParam === "tools" || tabParam === "checkins" ? tabParam : showImport || mergeKeep ? "tools" : "directory";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title={t("ppl_title")} />
        <EmptyState>{t("play_no_db")}</EmptyState>
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
        title={t("ppl_title")}
        subtitle={t("ppl_subtitle", { total: everyone.length, signed: signedIn, installed })}
      />
      <Tabs
        label={t("ppl_title")}
        current={tab}
        items={[
          { key: "directory", label: t("ppl_tab_directory"), href: tabHref("directory"), count: everyone.length },
          { key: "tools", label: t("ppl_tab_tools"), href: tabHref("tools") },
          { key: "checkins", label: t("ppl_tab_checkins"), href: tabHref("checkins"), count: checkIns.length },
        ]}
      />
      {tab === "directory" && <Directory players={players} q={q} t={t} />}
      {tab === "tools" && <Tools t={t} showImport={Boolean(showImport)} mergeKeep={mergeKeep} mergeDupe={mergeDupe} players={everyone} />}
      {tab === "checkins" && <CheckIns checkIns={checkIns} t={t} />}
    </div>
  );
}

function Directory({ players, q, t }: { players: Awaited<ReturnType<typeof listPlayersForAdmin>>; q?: string; t: T }) {
  return (
    <>
      <Form action="/admin/players" className={kit.toolbar}>
        <label className={kit.srOnly} htmlFor="player-search">
          {t("ppl_search_label")}
        </label>
        <input id="player-search" name="q" type="search" defaultValue={q ?? ""} placeholder={t("ppl_search_ph")} className={kit.input} style={{ flex: "1 1 260px", maxWidth: 420 }} />
        <SubmitButton className={kit.btnSecondary} loadingText={t("ppl_searching")}>
          {t("common_search")}
        </SubmitButton>
        {q && (
          <AdminLink href="/admin/players" className={kit.btnSecondary}>
            {t("ppl_clear")}
          </AdminLink>
        )}
      </Form>
      {players.length === 0 ? (
        <EmptyState>{q ? t("ppl_no_match", { q }) : t("ppl_none_yet")}</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>{t("ppl_caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("play_col_player")}</th>
                <th scope="col">{t("ppl_col_membership")}</th>
                <th scope="col">{t("ppl_col_account")}</th>
                <th scope="col">{t("ppl_col_phone")}</th>
                <th scope="col">
                  <span className={kit.srOnly}>{t("play_col_actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td data-label={t("play_col_player")}>
                    <div>
                      <strong>
                        {p.firstName} {p.lastName}
                      </strong>
                      <span className={kit.sub}>{p.email}</span>
                      {p.displayName && <span className={kit.sub}>{t("ppl_shown_as", { name: p.displayName })}</span>}
                    </div>
                  </td>
                  <td data-label={t("ppl_col_membership")}>
                    {p.activeMembership ? (
                      p.activeMembership
                        .split(" · ")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" · ")
                    ) : (
                      <span className={kit.muted}>{t("common_none")}</span>
                    )}
                  </td>
                  <td data-label={t("ppl_col_account")}>
                    <div>
                      {p.claimedAt ? <Badge tone="good">{t("ppl_signed_in_since", { date: formatNz(p.claimedAt) })}</Badge> : <Badge tone="warn">{t("ppl_never_signed_in")}</Badge>}
                      {p.installedAt && <span className={kit.sub}>{t("ppl_app_installed")}</span>}
                      {!p.leaderboardVisible && <span className={kit.sub}>{t("ppl_hidden_board")}</span>}
                      {p.welcomeSentAt && <span className={kit.sub}>{t("ppl_welcome_sent", { date: formatNz(p.welcomeSentAt) })}</span>}
                    </div>
                  </td>
                  <td data-label={t("ppl_col_phone")}>
                    <div>
                      {p.phone ?? <span className={kit.muted}>—</span>}
                      {p.phone && <span className={kit.sub}>{p.phoneVerified ? t("ppl_phone_confirmed") : t("ppl_phone_unconfirmed")}</span>}
                    </div>
                  </td>
                  <td data-label="">
                    <div className={kit.rowActions}>
                      <AdminLink href={`/admin/inbox?to=${encodeURIComponent(p.email)}#new`} className={kit.btnSecondary}>
                        {t("ppl_message")}
                      </AdminLink>
                      <details className={kit.inlineEdit}>
                        <summary className={kit.btnSecondary}>{t("ppl_change_email")}</summary>
                        <form action={changeEmail.bind(null, p.id)} className={kit.rowActions}>
                          <input name="email" type="email" placeholder="new@email.com" required className={kit.input} aria-label={t("ppl_new_email_for", { name: p.firstName })} />
                          <SubmitButton className={kit.btn} loadingText={t("play_saving")} confirmMessage={t("ppl_change_email_confirm", { email: p.email })}>
                            {t("common_save")}
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
  t,
  showImport,
  mergeKeep,
  mergeDupe,
  players,
}: {
  t: T;
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
      mergePreview = { error: err instanceof MergeError ? err.message : t("ppl_err_merge_failed", { error: (err as Error).message }) };
    }
  }
  const unlinked = nameMatches.filter((m) => !m.playerId).length;

  return (
    <>
      <Section title={t("ppl_merge_title")} id="merge">
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          {t("ppl_merge_intro")}
        </p>
        <form action={previewMerge} className={kit.formGrid}>
          <label className={kit.field}>
            {t("ppl_merge_dupe")}
            <input name="merge" type="email" required defaultValue={mergeDupe ?? ""} className={kit.input} />
          </label>
          <label className={kit.field}>
            {t("ppl_merge_keep")}
            <input name="keep" type="email" required defaultValue={mergeKeep ?? ""} className={kit.input} />
          </label>
          <div>
            <SubmitButton className={kit.btnSecondary} loadingText={t("ppl_merge_checking")}>
              {t("ppl_merge_preview")}
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
              {mergePreview.mergeName ? ` (${mergePreview.mergeName})` : ` ${t("ppl_no_account")}`} → <strong>{mergePreview.keepEmail}</strong>
              {mergePreview.keepName ? ` (${mergePreview.keepName})` : ` ${t("ppl_no_account")}`}
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
              <p className={kit.muted}>{t("ppl_merge_nothing")}</p>
            )}
            {mergePreview.notes.map((n) => (
              <p key={n} className={kit.muted} style={{ margin: "0 0 4px" }}>
                {n}
              </p>
            ))}
            <form action={applyMerge.bind(null, mergePreview.keepEmail, mergePreview.mergeEmail)} style={{ marginTop: 8 }}>
              <SubmitButton className={kit.btn} loadingText={t("ppl_merging")} confirmMessage={t("ppl_merge_confirm", { from: mergePreview.mergeEmail, to: mergePreview.keepEmail })}>
                {t("ppl_merge_now")}
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </Section>

      <Section title={t("ppl_points_title")}>
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          {t("ppl_points_intro", { unlinked: unlinked ? t("ppl_points_unlinked", { n: unlinked }) : "" })}
        </p>
        <InfoDisclosure summary={t("ppl_how_counted")}>
          <p>{t(backfill.boardDays === 1 ? "ppl_how_1_one" : "ppl_how_1_many", { boards: backfill.boardDays, draws: backfill.draws })}</p>
          <p>{t("ppl_how_2")}</p>
        </InfoDisclosure>
        <form action={backfillStats} style={{ marginBottom: 14 }}>
          <SubmitButton className={kit.btnSecondary} loadingText={t("ppl_recalc_busy")}>
            {t("ppl_recalc")}
          </SubmitButton>
        </form>
        {nameMatches.length === 0 ? (
          <EmptyState>{t("ppl_rr_none")}</EmptyState>
        ) : (
          <div className={kit.tableWrap}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>{t("ppl_rr_caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ppl_rr_col_name")}</th>
                  <th scope="col">{t("ppl_rr_col_player")}</th>
                </tr>
              </thead>
              <tbody>
                {nameMatches.map((m) => (
                  <tr key={m.name}>
                    <td data-label={t("ppl_rr_col_name")}>
                      <strong>{m.name}</strong> {!m.playerId && <Badge tone="warn">{t("ppl_not_linked")}</Badge>}
                    </td>
                    <td data-label={t("ppl_rr_col_player")}>
                      <form action={saveMinigameName} className={kit.rowActions}>
                        <input type="hidden" name="name" value={m.name} />
                        <select name="playerId" defaultValue={m.playerId ?? ""} className={kit.select} aria-label={t("ppl_player_for", { name: m.name })}>
                          <option value="">{t("ppl_not_linked")}</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.firstName} {p.lastName} ({p.email})
                            </option>
                          ))}
                        </select>
                        <SubmitButton className={kit.btnSecondary} loadingText={t("play_saving")}>
                          {t("common_save")}
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

      <Section title={t("ppl_create_title")}>
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          {t("ppl_create_intro")}
        </p>
        <div className={kit.rowActions}>
          <AdminLink href="/admin/players?tab=tools&import=1" className={kit.btnSecondary}>
            {t("ppl_preview")}
          </AdminLink>
          <form action={importMembers}>
            <SubmitButton className={kit.btn} loadingText={t("ppl_creating")} confirmMessage={t("ppl_create_confirm")}>
              {t("ppl_create_btn")}
            </SubmitButton>
          </form>
        </div>
        {candidates && (
          <div className={kit.tableWrap} style={{ marginTop: 14 }}>
            <table className={kit.table}>
              <caption className={kit.srOnly}>{t("ppl_to_create_caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ppl_col_member")}</th>
                  <th scope="col">{t("ppl_col_membership")}</th>
                  <th scope="col">{t("ppl_col_account")}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.email}>
                    <td data-label={t("ppl_col_member")}>
                      <div>
                        {c.firstName} {c.lastName}
                        <span className={kit.sub}>{c.email}</span>
                      </div>
                    </td>
                    <td data-label={t("ppl_col_membership")}>{c.plans.join(", ")}</td>
                    <td data-label={t("ppl_col_account")}>
                      <div className={kit.rowActions}>
                        {c.hasAccount ? <Badge tone="good">{t("ppl_has_account")}</Badge> : <Badge tone="warn">{t("ppl_will_create")}</Badge>}
                        {c.nearDuplicates.length > 0 && <Badge tone="bad">{t("ppl_possible_dupe", { who: c.nearDuplicates.join(", ") })}</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("ppl_welcome_title")}>
        <p className={kit.muted} style={{ fontSize: 13, marginTop: -4 }}>
          {t(welcomePending === 1 ? "ppl_welcome_intro_one" : "ppl_welcome_intro_many", { n: welcomePending, club: clubShortName(), batch: WELCOME_BATCH })}
        </p>
        <div className={kit.rowActions}>
          <form action={previewWelcome}>
            <SubmitButton className={kit.btnSecondary} loadingText={t("ppl_sending")}>
              {t("ppl_send_preview")}
            </SubmitButton>
          </form>
          <form action={sendWelcome}>
            <SubmitButton
              className={kit.btn}
              loadingText={t("ppl_sending")}
              disabled={welcomePending === 0}
              confirmMessage={t("ppl_send_welcome_confirm", { n: Math.min(welcomePending, WELCOME_BATCH) })}
            >
              {t("ppl_send_welcome")}
            </SubmitButton>
          </form>
        </div>
      </Section>

      <Section title={t("ppl_sms_title")}>
        <p style={{ fontSize: 14, margin: "-4px 0 6px" }}>
          {t("ppl_sms_used")}<strong>{t("ppl_sms_of", { used: sms.used, limit: sms.limit })}</strong>{t("ppl_sms_free")}
          {sms.nextSlotAt && t("ppl_sms_next", { date: formatNz(sms.nextSlotAt, true) })}
        </p>
        <p className={kit.muted} style={{ fontSize: 13 }}>
          {!sms.configured
            ? t("ppl_sms_not_set")
            : !sms.switchedOn
              ? t("ppl_sms_off")
              : sms.available
                ? t("ppl_sms_on")
                : t("ppl_sms_used_up")}
        </p>
        {sms.configured && (
          <form action={toggleSms.bind(null, !sms.switchedOn)}>
            <SubmitButton className={kit.btnSecondary} loadingText={t("play_saving")}>
              {sms.switchedOn ? t("ppl_sms_turn_off") : t("ppl_sms_turn_on")}
            </SubmitButton>
          </form>
        )}
      </Section>
    </>
  );
}

function CheckIns({ checkIns, t }: { checkIns: Awaited<ReturnType<typeof listUnverifiedAttendance>>; t: T }) {
  return (
    <>
      <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
        {t("ppl_ci_intro")}
      </p>
      {checkIns.length === 0 ? (
        <EmptyState>{t("ppl_ci_none")}</EmptyState>
      ) : (
        <div className={kit.tableWrap}>
          <table className={kit.table}>
            <caption className={kit.srOnly}>{t("ppl_ci_caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("ppl_ci_col_day")}</th>
                <th scope="col">{t("play_col_player")}</th>
                <th scope="col">
                  <span className={kit.srOnly}>{t("play_col_actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {checkIns.map((c) => (
                <tr key={`${c.date}-${c.email}`}>
                  <td data-label={t("ppl_ci_col_day")}>{formatNz(`${c.date}T12:00:00Z`)}</td>
                  <td data-label={t("play_col_player")}>{c.email}</td>
                  <td data-label="">
                    <div className={kit.rowActions}>
                      <form action={confirmCheckIn.bind(null, c.date, c.email, true)}>
                        <SubmitButton className={kit.btn} loadingText={t("play_saving")}>
                          {t("att_confirm")}
                        </SubmitButton>
                      </form>
                      <form action={confirmCheckIn.bind(null, c.date, c.email, false)}>
                        <SubmitButton className={kit.btnSecondary} loadingText={t("play_saving")} confirmMessage={t("ppl_ci_reject_confirm", { email: c.email })}>
                          {t("ppl_ci_reject")}
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
