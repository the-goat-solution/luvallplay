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

export const dynamic = "force-dynamic";

async function startConversation(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!email || !subject || !body) redirect("/admin/inbox?toastError=" + encodeURIComponent("Email, subject and message are all needed."));
  const player = await getPlayerByEmail(email);
  if (!player) redirect("/admin/inbox?toastError=" + encodeURIComponent(`No player account for ${email}.`));
  const id = await createThread({ playerId: player.id, subject, body, startedBy: "admin" });
  await notifyPlayerOfReply({ to: player.email, lang: player.lang, threadId: id, subject, body });
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox/${id}?toast=` + encodeURIComponent("Message sent."));
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string; to?: string }> }) {
  const { filter: rawFilter, to } = await searchParams;
  const filter = rawFilter === "closed" || rawFilter === "all" ? rawFilter : "open";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const threads = hasDb ? await listThreadsForAdmin(filter) : [];
  const unread = threads.filter((t) => t.unread).length;

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Inbox"
        subtitle="Conversations with players. They write from the Account tab of their profile; you can start one too. Unread first."
      />

      <FormPanel summary="＋ New message" title="Message a player" id="new" defaultOpen={Boolean(to)}>
        <p className={kit.muted} style={{ fontSize: 13, margin: 0 }}>
          They get an email that there&apos;s a message, with a link to the conversation. They need a player account.
        </p>
        <form action={startConversation} style={{ display: "grid", gap: 10, maxWidth: 620, marginTop: 10 }}>
          <label className={kit.field}>
            Player&apos;s email
            <input name="email" type="email" required className={kit.input} defaultValue={to ?? ""} />
          </label>
          <label className={kit.field}>
            Subject
            <input name="subject" maxLength={120} required className={kit.input} />
          </label>
          <label className={kit.field}>
            Message
            <textarea name="body" rows={5} maxLength={4000} required className={`${kit.input} ${s.textarea}`} />
          </label>
          <div>
            <SubmitButton className={kit.btn} loadingText="Sending…">
              Send
            </SubmitButton>
          </div>
        </form>
      </FormPanel>

      <Tabs
        label="Conversations"
        current={filter}
        items={[
          { key: "open", label: "Open", href: "/admin/inbox", count: filter === "open" ? threads.length : undefined },
          { key: "closed", label: "Closed", href: "/admin/inbox?filter=closed" },
          { key: "all", label: "All", href: "/admin/inbox?filter=all" },
        ]}
      />

      {threads.length === 0 ? (
        <EmptyState>{filter === "open" ? "No open conversations. You're all caught up." : `No ${filter === "all" ? "" : "closed "}conversations yet.`}</EmptyState>
      ) : (
        <>
          {unread > 0 && (
            <p className={kit.muted} style={{ fontSize: 13, marginTop: 0 }}>
              {unread} unread
            </p>
          )}
          <ul className={s.list}>
            {threads.map((t) => (
              <li key={t.id}>
                <AdminLink href={`/admin/inbox/${t.id}`} className={`${s.thread} ${t.unread ? s.unread : ""}`}>
                  <span className={s.top}>
                    {t.unread && <Badge tone="bad">New</Badge>}
                    <span className={s.subject}>{t.subject}</span>
                    <span className={s.who}>{t.playerName}</span>
                    {t.status === "closed" && <Badge>Closed</Badge>}
                    <span className={s.when}>{formatNz(t.lastMessageAt, true)}</span>
                  </span>
                  <span className={s.preview}>
                    {t.lastSender === "admin" ? "You: " : ""}
                    {t.preview}
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
