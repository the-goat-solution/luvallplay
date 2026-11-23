import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnSecondary, card, formatNz, input, pill } from "@/components/admin/ui";
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

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Inbox</h1>
      <p style={{ marginTop: 0 }}>
        <AdminLink href="/admin/inbox">← All conversations</AdminLink>
      </p>

      <section style={card}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{thread.subject}</h2>
          {thread.status === "closed" && <span style={pill("#eee", "#666")}>Closed</span>}
          <span style={{ color: "#666", fontSize: 13 }}>
            with{" "}
            <AdminLink href={`/admin/players?q=${encodeURIComponent(thread.playerEmail)}`}>{thread.playerName}</AdminLink> ({thread.playerEmail})
          </span>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {thread.messages.map((m) => (
            <div
              key={m.id}
              style={{
                justifySelf: m.sender === "admin" ? "end" : "start",
                maxWidth: "80%",
                background: m.sender === "admin" ? "#1a2a4a" : "#f2efe3",
                color: m.sender === "admin" ? "#fff" : "#222",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 3 }}>
                {m.sender === "admin" ? "Club" : thread.playerName} · {formatNz(m.createdAt, true)}
              </div>
              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={card}>
        <form action={reply.bind(null, thread.id)} style={{ display: "grid", gap: 8 }}>
          <textarea name="body" rows={4} maxLength={4000} placeholder={`Reply to ${thread.playerName}…`} required style={{ ...input, fontFamily: "inherit" }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SubmitButton loadingText="Sending…" style={btn}>
              Send reply
            </SubmitButton>
          </div>
        </form>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 0 }}>The player gets an email that you replied, with a link to the conversation.</p>
      </section>

      <form action={setStatus.bind(null, thread.id, thread.status === "open" ? "closed" : "open")}>
        <SubmitButton loadingText="Saving…" style={btnSecondary}>
          {thread.status === "open" ? "Close conversation" : "Reopen conversation"}
        </SubmitButton>
      </form>
    </div>
  );
}
