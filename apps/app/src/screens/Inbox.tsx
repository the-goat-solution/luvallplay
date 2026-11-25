// The inbox: conversations with the club's admins (the website's inbox
// sheet). On a phone the list and a conversation are one screen each, with
// a way back; when the screen is wide enough they sit side by side.
//   /inbox          the list
//   /inbox/new      writing a new message
//   /inbox/<id>     one conversation (reading it marks it read)
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCurrentClub, useLang, useT } from "../hooks.tsx";
import { localeOf } from "../lib/format.ts";
import { useReply, useStartThread, useThread, useThreads, type Thread } from "./inbox/data.ts";
import { LoadError } from "../components/LoadError.tsx";

type T = ReturnType<typeof useT>;

/** The time today, else the day: in the person's own time zone (it's when they read it), the club's way of writing. */
function when(iso: string, locale: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(locale, today ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" });
}

function useLocale(): string {
  const { config } = useCurrentClub();
  return localeOf(useLang(), config?.club.country ?? "NZ");
}

function sendError(t: T, err: unknown): string {
  return (err as { status?: number }).status === 429 ? t("msg_too_many") : t("msg_failed");
}

function ThreadList({ openId }: { openId: number | null }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const locale = useLocale();
  const threads = useThreads();
  if (!threads.data) {
    return threads.isError ? (
      <div className="stack">
        <LoadError onRetry={() => void threads.refetch()} />
      </div>
    ) : (
      <p className="muted" role="status">{t("loading")}</p>
    );
  }
  if (threads.data.threads.length === 0) return <p className="muted">{t("msg_empty")}</p>;
  return (
    <ul className="threads">
      {threads.data.threads.map((th) => (
        <li key={th.id} className={th.unread ? "thread unread" : "thread"}>
          <Link to="/inbox/$id" params={{ id: String(th.id) }} className="thread-link" aria-current={th.id === openId ? "true" : undefined}>
            <span className="thread-top">
              <strong>
                {th.unread && <span className="unread-dot" aria-hidden="true" />}
                {th.subject}
              </strong>
              <span className="muted small">{when(th.lastMessageAt, locale)}</span>
            </span>
            <span className="muted small thread-preview">
              {th.lastSender === "player" ? `${t("msg_you")}: ` : ""}
              {th.preview}
            </span>
            {th.unread && <span className="visually-hidden">{t("msg_new_badge")}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Messages({ thread }: { thread: Thread }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const locale = useLocale();
  const end = useRef<HTMLLIElement>(null);
  const count = thread.messages.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count]);
  return (
    <ol className="messages">
      {thread.messages.map((m, i) => (
        <li key={m.id} className={`message message-${m.sender}`} ref={i === count - 1 ? end : undefined}>
          <span className="message-who small">
            {m.sender === "player" ? t("msg_you") : config?.club.name}
            {" · "}
            <time dateTime={m.createdAt}>{when(m.createdAt, locale)}</time>
          </span>
          <p className="message-body">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

function ThreadView({ id }: { id: number }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const thread = useThread(id);
  const reply = useReply(id);
  const [draft, setDraft] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [id, thread.data?.id]);

  if (!thread.data) {
    if ((thread.error as { status?: number } | null)?.status === 404) return <p role="alert">{t("msg_not_found")}</p>;
    return thread.isError ? <p role="alert">{t("me_retry_load")}</p> : <p className="muted" role="status">{t("loading")}</p>;
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    reply.mutate(body, { onSuccess: () => setDraft("") });
  };
  return (
    <div className="stack">
      <h2 ref={title} tabIndex={-1} className="title focus-target">{thread.data.subject}</h2>
      {thread.data.status === "closed" && <p className="notice">{t("msg_closed")}</p>}
      <Messages thread={thread.data} />
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span className="visually-hidden">{t("msg_body")}</span>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("msg_placeholder")} maxLength={4000} rows={3} required />
        </label>
        {reply.isError && <p className="notice notice-error" role="alert">{sendError(t, reply.error)}</p>}
        <div>
          <button type="submit" className="button button-primary" disabled={reply.isPending || !draft.trim()}>
            {reply.isPending ? t("msg_sending") : t("msg_send")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Compose() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const navigate = useNavigate();
  const start = useStartThread();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    start.mutate({ subject: subject.trim(), body: body.trim() }, { onSuccess: (r) => void navigate({ to: "/inbox/$id", params: { id: String(r.id) }, replace: true }) });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h2>{t("msg_new")}</h2>
      <label className="field">
        <span>{t("msg_subject")}</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} required autoComplete="off" />
      </label>
      <label className="field">
        <span>{t("msg_body")}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("msg_placeholder")} maxLength={4000} rows={5} required />
      </label>
      {start.isError && <p className="notice notice-error" role="alert">{sendError(t, start.error)}</p>}
      <div>
        <button type="submit" className="button button-primary" disabled={start.isPending || !subject.trim() || !body.trim()}>
          {start.isPending ? t("msg_sending") : t("msg_send")}
        </button>
      </div>
    </form>
  );
}

export default function InboxScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const { pathname } = useLocation();
  const params = useParams({ strict: false }) as { id?: string };
  const composing = /\/inbox\/new\/?$/.test(pathname);
  const id = !composing && params.id && /^\d{1,10}$/.test(params.id) ? Number(params.id) : null;
  const detail = composing || id !== null || (!!params.id && !composing);
  return (
    <section className="screen stack" data-screen="msg_title" data-open={detail ? "detail" : "list"}>
      <h1>{t("msg_title")}</h1>
      <div className="inbox">
        <div className="inbox-list card stack">
          <p className="muted small">{t("msg_sub")}</p>
          <div>
            <Link to="/inbox/new" className="button button-primary" aria-current={composing ? "page" : undefined}>
              {t("msg_new")}
            </Link>
          </div>
          <ThreadList openId={id} />
        </div>
        <div className="inbox-detail card stack">
          <Link to="/inbox" className="back">
            <span aria-hidden="true">← </span>
            {t("msg_back")}
          </Link>
          {composing ? <Compose /> : id !== null ? <ThreadView key={id} id={id} /> : params.id ? <p role="alert">{t("msg_not_found")}</p> : <p className="muted">{t("msg_pick")}</p>}
        </div>
      </div>
    </section>
  );
}
