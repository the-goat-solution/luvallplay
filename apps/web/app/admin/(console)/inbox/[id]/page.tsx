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

export const dynamic = "force-dynamic";

async function reply(threadId: number, formData: FormData) {
  "use server";
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(`/admin/inbox/${threadId}?toastError=` + encodeURIComponent("Write a reply first."));
  const thread = await getThreadForAdmin(threadId);
  if (!thread) notFound();
  await addAdminMessage(threadId, body);
  await notifyPlayerOfReply({ to: thread.playerEmail, lang: thread.playerLang, threadId, subject: thread.subject, body });
  revalidatePath(`/admin/inbox/${threadId}`);
  redirect(`/admin/inbox/${threadId}?toast=` + encodeURIComponent(`Reply sent to ${thread.playerName}.`));
}

async function setStatus(threadId: number, status: "open" | "closed") {
  "use server";
  await setThreadStatus(threadId, status);
  revalidatePath("/admin/inbox");
  redirect(status === "closed" ? "/admin/inbox?toast=" + encodeURIComponent("Conversation closed.") : `/admin/inbox/${threadId}`);
}

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const thread = await getThreadForAdmin(id);
  if (!thread) notFound();
  const open = thread.status === "open";

  return (
    <div className={adminStyles.page}>
      <p className={s.crumb}>
        <AdminLink href="/admin/inbox">← Inbox</AdminLink>
      </p>
      <PageHeader
        title={thread.subject}
        subtitle={
          <>
            With <AdminLink href={`/admin/players?q=${encodeURIComponent(thread.playerEmail)}`}>{thread.playerName}</AdminLink> ({thread.playerEmail})
            {!open && (
              <>
                {" "}
                <Badge>Closed</Badge>
              </>
            )}
          </>
        }
        actions={
          <form action={setStatus.bind(null, thread.id, open ? "closed" : "open")}>
            <SubmitButton className={kit.btnSecondary} loadingText="Saving…">
              {open ? "Close conversation" : "Reopen conversation"}
            </SubmitButton>
          </form>
        }
      />

      <Section>
        <div className={s.messages}>
          {thread.messages.map((m) => (
            <div key={m.id} className={`${s.bubble} ${m.sender === "admin" ? s.mine : s.theirs}`}>
              <div className={s.meta}>
                {m.sender === "admin" ? "Club" : thread.playerName} · {formatNz(m.createdAt, true)}
              </div>
              <div className={s.body}>{m.body}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Reply to ${thread.playerName}`}>
        <form action={reply.bind(null, thread.id)} style={{ display: "grid", gap: 10 }}>
          <label className={kit.srOnly} htmlFor="reply">
            Reply
          </label>
          <textarea id="reply" name="body" rows={4} maxLength={4000} placeholder="Write your reply…" required className={`${kit.input} ${s.textarea}`} />
          <div className={kit.rowActions}>
            <SubmitButton className={kit.btn} loadingText="Sending…">
              Send reply
            </SubmitButton>
            <span className={kit.muted}>They get an email that you replied, with a link to the conversation.</span>
          </div>
        </form>
      </Section>
    </div>
  );
}
