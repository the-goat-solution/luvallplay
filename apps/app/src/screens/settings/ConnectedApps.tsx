// Connected apps, as on the website's Settings: personal access keys (for a
// habit tracker or an AI assistant), webhooks, and where the MCP server and
// calendar feed live. A new key or webhook secret is shown once.
import { useId, useState, type FormEvent } from "react";
import { API_SCOPES } from "@luvallplay/api/schemas";
import type { AppKey } from "@luvallplay/i18n/app";
import { useCurrentClub, useLang, useT } from "../../hooks.tsx";
import { localeOf } from "../../lib/format.ts";
import type { T } from "../../lib/messages.ts";
import { useConnectedApps } from "./data.ts";

type Scope = (typeof API_SCOPES)[number];
const SCOPE_LABEL: Record<Scope, AppKey> = {
  "read:stats": "ca_scope_read_stats",
  "read:attendance": "ca_scope_read_attendance",
  "read:calendar": "ca_scope_read_calendar",
  "write:activity": "ca_scope_write_activity",
};

function Copy({ text, t }: { text: string; t: ReturnType<typeof useT> }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t("ca_copied") : t("ca_copy")}
    </button>
  );
}

/**
 * Revoking can't be undone (an app using the key stops working at once), so
 * it takes two taps: "Revoke", then the question with "Revoke" and "Cancel".
 */
function ConfirmRemove({ label, question, busy, onConfirm, t }: { label: string; question: string; busy: boolean; onConfirm: () => void; t: T }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="button button-quiet" disabled={busy} onClick={() => setAsking(true)} aria-label={label}>
        {t("ca_revoke")}
      </button>
    );
  }
  return (
    <span className="confirm-remove" role="group" aria-label={label}>
      <span className="small" role="status">{question}</span>
      <span className="actions">
        <button type="button" className="button button-small button-danger" disabled={busy} autoFocus onClick={onConfirm}>{t("ca_revoke")}</button>
        <button type="button" className="button button-small" onClick={() => setAsking(false)}>{t("cancel")}</button>
      </span>
    </span>
  );
}

export function ConnectedApps() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const id = useId();
  const { list, createToken, revokeToken, createWebhook, deleteWebhook } = useConnectedApps();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read:stats", "read:attendance"]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<AppKey | null>(null);
  const site = config?.club.webUrl ?? null;
  const tokens = list.data?.tokens ?? [];
  const webhooks = list.data?.webhooks ?? [];

  const addKey = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    createToken.mutate(
      { name: name.trim(), scopes },
      { onSuccess: (r) => { setNewKey(r.token); setName(""); }, onError: () => setError("error_generic") },
    );
  };
  const addWebhook = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    createWebhook.mutate(url.trim(), {
      onSuccess: (r) => { setSecret(r.secret); setUrl(""); },
      onError: (err) => setError((err as { code?: string }).code === "invalid_url" ? "ca_invalid_url" : "error_generic"),
    });
  };

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("ca_title")}</h2>
      <p className="muted small">{t("ca_sub")}</p>
      {list.isError && <p className="notice notice-error" role="alert">{t("me_retry_load")}</p>}
      {error && <p className="notice notice-error" role="alert">{t(error)}</p>}

      <details className="disclosure">
        <summary>{t("ca_tokens")} ({tokens.length})</summary>
        <div className="stack">
          {newKey && (
            <div className="notice stack" role="status">
              <span>{t("ca_token_once")}</span>
              <code className="code">{newKey}</code>
              <div><Copy text={newKey} t={t} /></div>
            </div>
          )}
          {tokens.length > 0 && (
            <ul className="rows">
              {tokens.map((k) => (
                <li key={k.id} className="row">
                  <span className="row-text">
                    <strong>{k.name}</strong>
                    <span className="muted small">
                      {k.prefix}… · {k.scopes.join(", ")} ·{" "}
                      {k.lastUsedAt ? t("ca_last_used", { date: new Date(k.lastUsedAt).toLocaleDateString(localeOf(lang, config?.club.country ?? "")) }) : t("ca_never_used")}
                    </span>
                  </span>
                  <ConfirmRemove label={`${t("ca_revoke")}: ${k.name}`} question={t("ca_revoke_confirm")} busy={revokeToken.isPending} onConfirm={() => revokeToken.mutate(k.id)} t={t} />
                </li>
              ))}
            </ul>
          )}
          <form className="stack" onSubmit={addKey}>
            <label className="field">
              <span>{t("ca_token_name")}</span>
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
            </label>
            <fieldset className="stack">
              <legend>{t("ca_scopes")}</legend>
              {API_SCOPES.map((s) => (
                <label key={s} className="choice">
                  <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
                  <span>{t(SCOPE_LABEL[s])}</span>
                </label>
              ))}
            </fieldset>
            <div>
              <button type="submit" className="button button-primary" disabled={!name.trim() || scopes.length === 0 || createToken.isPending}>
                {t("ca_create")}
              </button>
            </div>
          </form>
        </div>
      </details>

      <details className="disclosure">
        <summary>{t("ca_webhooks")} ({webhooks.length})</summary>
        <div className="stack">
          <p className="muted small">{t("ca_webhook_events")}</p>
          {secret && (
            <div className="notice stack" role="status">
              <code className="code">{t("ca_webhook_secret", { secret })}</code>
              <div><Copy text={secret} t={t} /></div>
            </div>
          )}
          {webhooks.length > 0 && (
            <ul className="rows">
              {webhooks.map((w) => (
                <li key={w.id} className="row">
                  <span className="row-text">
                    <strong className="break">{w.url}</strong>
                    <span className="muted small">{w.lastStatus ?? "—"}</span>
                  </span>
                  <ConfirmRemove label={`${t("ca_revoke")}: ${w.url}`} question={t("ca_webhook_confirm")} busy={deleteWebhook.isPending} onConfirm={() => deleteWebhook.mutate(w.id)} t={t} />
                </li>
              ))}
            </ul>
          )}
          <form className="actions" onSubmit={addWebhook}>
            <label className="field grow">
              <span className="visually-hidden">{t("ca_webhook_url")}</span>
              <input type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </label>
            <button type="submit" className="button button-primary" disabled={createWebhook.isPending}>
              {t("ca_webhook_add")}
            </button>
          </form>
        </div>
      </details>

      {site && (
        <details className="disclosure">
          <summary>{t("ca_mcp")} · {t("ca_calendar")}</summary>
          <div className="stack">
            <p className="muted small">{t("ca_mcp_body")}</p>
            <code className="code">{`${site}/api/mcp`}</code>
            <p className="muted small">{t("ca_calendar_body")}</p>
            <code className="code">{`${site.replace(/^https?/, "webcal")}/api/v1/me/calendar.ics?token=<your key>`}</code>
            <p className="muted small">{t("ca_docs")}</p>
          </div>
        </details>
      )}
    </section>
  );
}
