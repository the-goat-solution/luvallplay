import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { formatNz } from "@/components/admin/ui";
import { Badge, PageHeader, Section, kit } from "@/components/admin/kit";
import s from "../inbox.module.css";
import { addAdminMessage, getThreadForAdmin, setThreadStatus } from "@/lib/messages-db";
import { notifyPlayerOfReply } from "@/lib/message-notify";
import { adminText } from "@/lib/admin-lang";

export const dynamic = "force-dynamic";

async function reply(threadId: number, formData: FormData) {
  "use server";
  const { t } = await adminText();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(`/admin/inbox/${threadId}?toastError=` + encodeURIComponent(t("inb_err_reply_first")));
  const thread = await getThreadForAdmin(threadId);
  if (!thread) notFound();
  await addAdminMessage(threadId, body);
  await notifyPlayerOfReply({ to: thread.playerEmail, lang: thread.playerLang, threadId, subject: thread.subject, body });
  revalidatePath(`/admin/inbox/${threadId}`);
  redirect(`/admin/inbox/${threadId}?toast=` + encodeURIComponent(t("inb_msg_reply_sent", { name: thread.playerName })));
}

async function setStatus(threadId: number, status: "open" | "closed") {
  "use server";
  const { t } = await adminText();
  await setThreadStatus(threadId, status);
  revalidatePath("/admin/inbox");
  redirect(status === "closed" ? "/admin/inbox?toast=" + encodeURIComponent(t("inb_msg_closed")) : `/admin/inbox/${threadId}`);
}

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await adminText();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const thread = await getThreadForAdmin(id);
  if (!thread) notFound();
  const open = thread.status === "open";

  return (
    <div className={adminStyles.page}>
      <p className={s.crumb}>
        <AdminLink href="/admin/inbox">{t("inb_back")}</AdminLink>
      </p>
      <PageHeader
        title={thread.subject}
        subtitle={
          <>
            {t("inb_with")}<AdminLink href={`/admin/players?q=${encodeURIComponent(thread.playerEmail)}`}>{thread.playerName}</AdminLink> ({thread.playerEmail})
            {!open && (
              <>
                {" "}
                <Badge>{t("inb_closed_badge")}</Badge>
              </>
            )}
          </>
        }
        actions={
          <form action={setStatus.bind(null, thread.id, open ? "closed" : "open")}>
            <SubmitButton className={kit.btnSecondary} loadingText={t("play_saving")}>
              {open ? t("inb_close") : t("inb_reopen")}
            </SubmitButton>
          </form>
        }
      />

      <Section>
        <div className={s.messages}>
          {thread.messages.map((m) => (
            <div key={m.id} className={`${s.bubble} ${m.sender === "admin" ? s.mine : s.theirs}`}>
              <div className={s.meta}>
                {m.sender === "admin" ? t("inb_club") : thread.playerName} · {formatNz(m.createdAt, true)}
              </div>
              <div className={s.body}>{m.body}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("inb_reply_to", { name: thread.playerName })}>
        <form action={reply.bind(null, thread.id)} style={{ display: "grid", gap: 10 }}>
          <label className={kit.srOnly} htmlFor="reply">
            {t("inb_reply")}
          </label>
          <textarea id="reply" name="body" rows={4} maxLength={4000} placeholder={t("inb_reply_ph")} required className={`${kit.input} ${s.textarea}`} />
          <div className={kit.rowActions}>
            <SubmitButton className={kit.btn} loadingText={t("inb_sending")}>
              {t("inb_send_reply")}
            </SubmitButton>
            <span className={kit.muted}>{t("inb_reply_note")}</span>
          </div>
        </form>
      </Section>
    </div>
  );
}
