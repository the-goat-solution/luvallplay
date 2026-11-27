import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { formatNz } from "@/components/admin/ui";
import { Badge, EmptyState, FormPanel, PageHeader, Tabs, kit } from "@/components/admin/kit";
import s from "./inbox.module.css";
import { createThread, listThreadsForAdmin } from "@/lib/messages-db";
import { getPlayerByEmail } from "@/lib/player-db";
import { notifyPlayerOfReply } from "@/lib/message-notify";
import { adminText } from "@/lib/admin-lang";

export const dynamic = "force-dynamic";

async function startConversation(formData: FormData) {
  "use server";
  const { t } = await adminText();
  const email = String(formData.get("email") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!email || !subject || !body) redirect("/admin/inbox?toastError=" + encodeURIComponent(t("inb_err_needed")));
  const player = await getPlayerByEmail(email);
  if (!player) redirect("/admin/inbox?toastError=" + encodeURIComponent(t("inb_err_no_player", { email })));
  const id = await createThread({ playerId: player.id, subject, body, startedBy: "admin" });
  await notifyPlayerOfReply({ to: player.email, lang: player.lang, threadId: id, subject, body });
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox/${id}?toast=` + encodeURIComponent(t("inb_msg_sent")));
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string; to?: string; subject?: string }> }) {
  const { t } = await adminText();
  const { filter: rawFilter, to, subject } = await searchParams;
  const filter = rawFilter === "closed" || rawFilter === "all" ? rawFilter : "open";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const threads = hasDb ? await listThreadsForAdmin(filter) : [];
  const unread = threads.filter((th) => th.unread).length;

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title={t("inb_title")}
        subtitle={t("inb_subtitle")}
      />

      <FormPanel summary={t("inb_new_summary")} title={t("inb_new_title")} id="new" defaultOpen={Boolean(to)}>
        <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
          {t("inb_new_intro")}
        </p>
        <form action={startConversation} style={{ display: "grid", gap: 10, maxWidth: 620, marginTop: 10 }}>
          <label className={kit.field}>
            {t("inb_player_email")}
            <input name="email" type="email" required className={kit.input} defaultValue={to ?? ""} />
          </label>
          <label className={kit.field}>
            {t("inb_subject")}
            <input name="subject" maxLength={120} required className={kit.input} defaultValue={subject ?? ""} />
          </label>
          <label className={kit.field}>
            {t("inb_message")}
            <textarea name="body" rows={5} maxLength={4000} required className={`${kit.input} ${s.textarea}`} />
          </label>
          <div>
            <SubmitButton className={kit.btn} loadingText={t("inb_sending")}>
              {t("inb_send")}
            </SubmitButton>
          </div>
        </form>
      </FormPanel>

      <Tabs
        label={t("inb_tabs_label")}
        current={filter}
        items={[
          { key: "open", label: t("inb_tab_open"), href: "/admin/inbox", count: filter === "open" ? threads.length : undefined },
          { key: "closed", label: t("inb_tab_closed"), href: "/admin/inbox?filter=closed" },
          { key: "all", label: t("inb_tab_all"), href: "/admin/inbox?filter=all" },
        ]}
      />

      {threads.length === 0 ? (
        <EmptyState>{filter === "open" ? t("inb_none_open") : filter === "all" ? t("inb_none_all") : t("inb_none_closed")}</EmptyState>
      ) : (
        <>
          {unread > 0 && (
            <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
              {t("inb_unread", { n: unread })}
            </p>
          )}
          <ul className={s.list}>
            {threads.map((th) => (
              <li key={th.id}>
                <AdminLink href={`/admin/inbox/${th.id}`} className={`${s.thread} ${th.unread ? s.unread : ""}`}>
                  <span className={s.top}>
                    {th.unread && <Badge tone="bad">{t("inb_new_badge")}</Badge>}
                    <span className={s.subject}>{th.subject}</span>
                    <span className={s.who}>{th.playerName}</span>
                    {th.status === "closed" && <Badge>{t("inb_closed_badge")}</Badge>}
                    <span className={s.when}>{formatNz(th.lastMessageAt, true)}</span>
                  </span>
                  <span className={s.preview}>
                    {th.lastSender === "admin" ? t("inb_you") : ""}
                    {th.preview}
                  </span>
                </AdminLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
