import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, card, formatNz, input, pill } from "@/components/admin/ui";
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

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: rawFilter } = await searchParams;
  const filter = rawFilter === "closed" || rawFilter === "all" ? rawFilter : "open";
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const threads = hasDb ? await listThreadsForAdmin(filter) : [];

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Inbox</h1>
      <p className={adminStyles.subtitle}>Messages from players, sent from the Account tab of their profile. Unread conversations are listed first.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(["open", "closed", "all"] as const).map((f) => (
          <AdminLink
            key={f}
            href={`/admin/inbox?filter=${f}`}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #ccc",
              textDecoration: "none",
              fontSize: 13,
              background: f === filter ? "#1a2a4a" : "#fff",
              color: f === filter ? "#fff" : "#333",
            }}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </AdminLink>
        ))}
      </div>

      <section style={card}>
        {threads.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>No {filter === "all" ? "" : filter} conversations.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {threads.map((t) => (
              <li key={t.id} style={{ borderBottom: "1px solid #eee" }}>
                <AdminLink
                  href={`/admin/inbox/${t.id}`}
                  style={{ display: "block", padding: "12px 4px", textDecoration: "none", color: "#222" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    {t.unread && <span style={pill("#d64545", "#fff")}>New</span>}
                    <strong style={{ fontWeight: t.unread ? 700 : 600 }}>{t.subject}</strong>
                    <span style={{ color: "#666", fontSize: 13 }}>· {t.playerName}</span>
                    {t.status === "closed" && <span style={pill("#eee", "#666")}>Closed</span>}
                    <span style={{ marginLeft: "auto", color: "#888", fontSize: 12 }}>{formatNz(t.lastMessageAt, true)}</span>
                  </div>
                  <div style={{ color: "#666", fontSize: 13, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.lastSender === "admin" ? "You: " : ""}
                    {t.preview}
                  </div>
                </AdminLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Message a player</h2>
        <form action={startConversation} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <input name="email" type="email" placeholder="Player's email" required style={input} />
          <input name="subject" placeholder="Subject" maxLength={120} required style={input} />
          <textarea name="body" placeholder="Message" rows={4} maxLength={4000} required style={{ ...input, fontFamily: "inherit" }} />
          <div>
            <SubmitButton loadingText="Sending…" style={btn}>
              Send
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
