"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { ApiToken, Scope, WebhookEndpoint } from "@/lib/webhooks";
import styles from "../profile.module.css";

const SCOPE_LABEL: Record<Scope, ProfileKey> = {
  "read:stats": "ca_scope_read_stats",
  "read:attendance": "ca_scope_read_attendance",
  "read:calendar": "ca_scope_read_calendar",
  "write:activity": "ca_scope_write_activity",
};

function Copy({ text }: { text: string }) {
  const { tr } = useProfileT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles.ghost}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? tr("ca_copied") : tr("ca_copy")}
    </button>
  );
}

const code: React.CSSProperties = {
  display: "block",
  background: "var(--cream-dark)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12.5,
  overflowWrap: "anywhere",
  fontFamily: "ui-monospace, Menlo, monospace",
};

/** Access keys, webhooks, MCP and calendar feed for one player. */
export function ConnectedApps({ tokens, webhooks, siteUrl }: { tokens: ApiToken[]; webhooks: WebhookEndpoint[]; siteUrl: string }) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read:stats", "read:attendance"]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/profile/integrations/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) return setError(tr("login_err_generic"));
    setNewToken(((await res.json()) as { token: string }).token);
    setName("");
    router.refresh();
  };

  const addWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/profile/integrations/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return setError(tr("ca_invalid_url"));
    setSecret(((await res.json()) as { secret: string }).secret);
    setUrl("");
    router.refresh();
  };

  const del = async (path: string) => {
    await fetch(path, { method: "DELETE" });
    router.refresh();
  };

  return (
    <section className={styles.card} aria-labelledby="ca-title">
      <h2 id="ca-title" className={styles.cardTitle}>
        {tr("ca_title")}
      </h2>
      <p className={styles.small} style={{ marginBottom: 14 }}>
        {tr("ca_sub")}
      </p>
      {error && <div className={styles.error}>{error}</div>}

      <details>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 700, color: "var(--navy)" }}>
          {tr("ca_tokens")} ({tokens.length})
        </summary>
        {newToken && (
          <div className={styles.success}>
            {tr("ca_token_once")}
            <code style={{ ...code, margin: "8px 0" }}>{newToken}</code>
            <Copy text={newToken} />
          </div>
        )}
        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0 }}>
          {tokens.map((t) => (
            <li key={t.id} className={styles.row} style={{ borderTop: "1px solid var(--line)" }}>
              <span className={styles.rowText}>
                <strong>{t.name}</strong>
                <span className={styles.small}>
                  {t.prefix}… · {t.scopes.join(", ")} ·{" "}
                  {t.lastUsedAt ? tr("ca_last_used", { date: new Date(t.lastUsedAt).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ") }) : tr("ca_never_used")}
                </span>
              </span>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => del(`/api/profile/integrations/tokens/${t.id}`)}>
                {tr("ca_revoke")}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={createToken}>
          <div className={styles.field}>
            <label htmlFor="ca-name">{tr("ca_token_name")}</label>
            <input id="ca-name" className={styles.input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="q.buzz" required />
          </div>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
            <legend className={styles.label} style={{ marginBottom: 6 }}>
              {tr("ca_scopes")}
            </legend>
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <label key={s} className={styles.row} style={{ minHeight: 44, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
                  style={{ width: 20, height: 20 }}
                />
                <span className={styles.rowText} style={{ fontSize: 14 }}>
                  {tr(SCOPE_LABEL[s])}
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className={`${styles.btn} ${styles.navy}`} disabled={!name.trim() || scopes.length === 0}>
            {tr("ca_create")}
          </button>
        </form>
      </details>

      <details>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 700, color: "var(--navy)" }}>
          {tr("ca_webhooks")} ({webhooks.length})
        </summary>
        <p className={styles.small} style={{ marginBottom: 10 }}>
          {tr("ca_webhook_events")}
        </p>
        {secret && (
          <div className={styles.success}>
            <code style={code}>{tr("ca_webhook_secret", { secret })}</code>
            <Copy text={secret} />
          </div>
        )}
        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0 }}>
          {webhooks.map((w) => (
            <li key={w.id} className={styles.row} style={{ borderTop: "1px solid var(--line)" }}>
              <span className={styles.rowText}>
                <strong style={{ overflowWrap: "anywhere", fontSize: 14 }}>{w.url}</strong>
                <span className={styles.small}>{w.lastStatus ?? "—"}</span>
              </span>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => del(`/api/profile/integrations/webhooks/${w.id}`)}>
                {tr("ca_revoke")}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addWebhook} className={styles.btnRow}>
          <input className={styles.input} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={tr("ca_webhook_url")} required />
          <button type="submit" className={`${styles.btn} ${styles.navy}`}>
            {tr("ca_webhook_add")}
          </button>
        </form>
      </details>

      <details>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 700, color: "var(--navy)" }}>
          {tr("ca_mcp")} · {tr("ca_calendar")}
        </summary>
        <p className={styles.small} style={{ margin: "4px 0 6px" }}>
          {tr("ca_mcp_body")}
        </p>
        <code style={code}>{`${siteUrl}/api/mcp`}</code>
        <p className={styles.small} style={{ margin: "12px 0 6px" }}>
          {tr("ca_calendar_body")}
        </p>
        <code style={code}>{`${siteUrl.replace(/^https?/, "webcal")}/api/v1/me/calendar.ics?token=<your key>`}</code>
        <p className={styles.small} style={{ marginTop: 12 }}>
          {tr("ca_docs")}
        </p>
      </details>
    </section>
  );
}
