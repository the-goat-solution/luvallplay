"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfileT } from "@/lib/profile-i18n";
import type { Message, ThreadDetail, ThreadSummary } from "@/lib/messages-db";
import styles from "./profile.module.css";
import m from "./messages.module.css";

const POLL_MS = 20_000;

function timeLabel(iso: string, lang: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(lang === "vi" ? "vi-VN" : "en-NZ", sameDay ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" });
}

/**
 * Conversations with the club admins. List ↔ thread inside one card, so
 * folding/unfolding a phone or resizing a window keeps the open thread, the
 * scroll position and any half-typed message (it's all component state).
 * The open thread refreshes every 20 seconds while the page is visible.
 */
export function MessagesPanel({ initialThreads }: { initialThreads: ThreadSummary[] }) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState(initialThreads);
  const [openId, setOpenId] = useState<number | null>(() => {
    const t = Number(searchParams.get("thread"));
    return Number.isInteger(t) && t > 0 ? t : null;
  });
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/profile/messages", { cache: "no-store" });
    if (res.ok) setThreads(((await res.json()) as { threads: ThreadSummary[] }).threads);
  }, []);

  const loadThread = useCallback(async (id: number) => {
    const res = await fetch(`/api/profile/messages/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { thread: ThreadDetail };
    setThread((prev) => {
      // Keep messages that are still sending (optimistic) at the end.
      const pending = prev?.id === id ? prev.messages.filter((x) => x.id < 0) : [];
      return { ...data.thread, messages: [...data.thread.messages, ...pending] };
    });
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }, []);

  useEffect(() => {
    if (openId === null) {
      setThread(null);
      return;
    }
    void loadThread(openId);
    const id = window.setInterval(() => {
      if (!document.hidden) void loadThread(openId);
    }, POLL_MS);
    const onVisible = () => !document.hidden && void loadThread(openId);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [openId, loadThread]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  const open = (id: number) => {
    setComposing(false);
    setOpenId(id);
    setError(null);
  };

  const backToList = () => {
    setOpenId(null);
    void refreshList();
    router.refresh(); // updates the tab badge
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || openId === null) return;
    setError(null);
    const temp: Message = { id: -Date.now(), sender: "player", body, createdAt: new Date().toISOString() };
    setThread((t) => (t ? { ...t, status: "open", messages: [...t.messages, temp] } : t));
    setDraft("");
    setSending(true);
    const res = await fetch(`/api/profile/messages/${openId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setSending(false);
    if (!res.ok) {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== temp.id) } : t));
      setDraft(body);
      setError(tr("msg_failed"));
      return;
    }
    const { message } = (await res.json()) as { message: Message };
    setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === temp.id ? message : x)) } : t));
  };

  const startThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !draft.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/profile/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body: draft }),
    });
    setSending(false);
    if (!res.ok) {
      setError(tr("msg_failed"));
      return;
    }
    const { id } = (await res.json()) as { id: number };
    setSubject("");
    setDraft("");
    setComposing(false);
    await refreshList();
    setOpenId(id);
  };

  return (
    <section className={styles.card} aria-labelledby="messages-title">
      <h2 id="messages-title" className={styles.cardTitle}>
        {tr("msg_title")}
        {openId === null && !composing && (
          <span>
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setComposing(true)}>
              + {tr("msg_new")}
            </button>
          </span>
        )}
      </h2>

      {error && <div className={styles.error}>{error}</div>}

      {composing && (
        <form onSubmit={startThread}>
          <div className={styles.field}>
            <label htmlFor="msg-subject">{tr("msg_subject")}</label>
            <input id="msg-subject" className={styles.input} maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="msg-body">{tr("msg_body")}</label>
            <textarea id="msg-body" className={styles.textarea} rows={4} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} required />
          </div>
          <div className={styles.btnRow}>
            <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => setComposing(false)}>
              {tr("cancel")}
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={sending || !subject.trim() || !draft.trim()}>
              {sending ? tr("msg_sending") : tr("msg_send")}
            </button>
          </div>
        </form>
      )}

      {!composing && openId === null && (
        <>
          <p className={styles.small} style={{ marginBottom: 10 }}>
            {tr("msg_sub")}
          </p>
          {threads.length === 0 ? (
            <p className={styles.muted}>{tr("msg_empty")}</p>
          ) : (
            <ul className={m.list}>
              {threads.map((t) => (
                <li key={t.id}>
                  <button type="button" className={m.threadBtn} onClick={() => open(t.id)}>
                    <span className={m.threadTop}>
                      <strong className={t.unread ? m.unread : undefined}>{t.subject}</strong>
                      <time>{timeLabel(t.lastMessageAt, lang)}</time>
                    </span>
                    <span className={m.preview}>
                      {t.unread && <span className={m.dot} aria-label={tr("msg_new_badge")} />}
                      {t.lastSender === "player" ? `${tr("msg_you")}: ` : ""}
                      {t.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {openId !== null && (
        <div className={m.thread}>
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={backToList} style={{ marginLeft: -12 }}>
            ‹ {tr("msg_back")}
          </button>
          {thread && <h3 className={m.subject}>{thread.subject}</h3>}
          <div className={m.bubbles} aria-live="polite">
            {thread?.messages.map((msg) => (
              <div key={msg.id} className={`${m.bubble} ${msg.sender === "player" ? m.mine : m.theirs} ${msg.id < 0 ? m.pending : ""}`}>
                <div className={m.meta}>
                  {msg.sender === "player" ? tr("msg_you") : tr("msg_club")} · {timeLabel(msg.createdAt, lang)}
                </div>
                <div className={m.body}>{msg.body}</div>
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
          {thread?.status === "closed" && <p className={styles.small}>{tr("msg_closed")}</p>}
          <form onSubmit={send} className={m.composer}>
            <textarea
              className={styles.textarea}
              rows={2}
              maxLength={4000}
              placeholder={tr("msg_placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={tr("msg_body")}
            />
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={sending || !draft.trim()}>
              {tr("msg_send")}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
