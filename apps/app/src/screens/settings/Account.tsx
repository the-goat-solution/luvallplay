// Settings' account cards: picture, details, privacy and the person's data,
// as on the website's Settings page. Changing the phone number is a separate
// (sign-in) step; here the number and its confirmation are shown only.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCurrentClub, useT } from "../../hooks.tsx";
import { squarePhoto } from "../../lib/photo.ts";
import { useDeleteAccount, useDownloadData, usePhoto, useProfile, useSaveDetails, useSavePrivacy, type Profile } from "./data.ts";
import { LoadError } from "../../components/LoadError.tsx";
import { Icon } from "../../components/Icon.tsx";

type T = ReturnType<typeof useT>;

function initials(p: Profile): string {
  return `${p.firstName.trim()[0] ?? p.email[0] ?? "?"}${p.lastName.trim()[0] ?? ""}`.toUpperCase();
}

function Photo({ p, t }: { p: Profile; t: T }) {
  const { save, remove } = usePhoto();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = save.isPending || remove.isPending;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    let image: string;
    try {
      image = await squarePhoto(file);
    } catch {
      setMessage({ ok: false, text: t("av_bad_photo") });
      return;
    }
    save.mutate(image, {
      onSuccess: () => setMessage({ ok: true, text: t("av_saved") }),
      onError: (err) => setMessage({ ok: false, text: (err as { code?: string }).code === "not_configured" ? t("av_not_configured") : t("av_failed") }),
    });
  };
  return (
    <section className="card stack" aria-labelledby="photo-title">
      <h2 id="photo-title">{t("av_title")}</h2>
      <div className="photo-row">
        <div className="avatar" aria-hidden="true">
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" width={64} height={64} /> : initials(p)}
        </div>
        <p className="muted small">{t("av_sub")}</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void choose(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      <div className="actions">
        <button type="button" className="button" disabled={busy} onClick={() => input.current?.click()}>
          {p.avatarUrl ? t("av_change") : t("av_add")}
        </button>
        {p.avatarUrl && (
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setMessage({ ok: true, text: t("av_removed") }), onError: () => setMessage({ ok: false, text: t("av_failed") }) })}
          >
            {t("av_remove")}
          </button>
        )}
      </div>
      {message && <p className={`notice${message.ok ? "" : " notice-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </section>
  );
}

function Details({ p, t }: { p: Profile; t: T }) {
  const save = useSaveDetails();
  const id = useId();
  const [form, setForm] = useState({ firstName: p.firstName, lastName: p.lastName, displayName: p.customDisplayName ? p.displayName : "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [form]);
  const dirty = form.firstName !== p.firstName || form.lastName !== p.lastName || form.displayName !== (p.customDisplayName ? p.displayName : "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), displayName: form.displayName.trim() || null }, { onSuccess: () => setSaved(true) });
  };
  return (
    <form className="card stack" aria-labelledby={`${id}-title`} onSubmit={submit}>
      <h2 id={`${id}-title`}>{t("acc_details")}</h2>
      <label className="field">
        <span>{t("acc_first_name")}</span>
        <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required maxLength={60} autoComplete="given-name" />
      </label>
      <label className="field">
        <span>{t("acc_last_name")}</span>
        <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={60} autoComplete="family-name" />
      </label>
      <label className="field">
        <span>{t("acc_display_name")}</span>
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={40} placeholder={p.defaultDisplayName} aria-describedby={`${id}-dn`} autoComplete="nickname" />
        <span className="muted small field-hint" id={`${id}-dn`}>{t("acc_display_name_hint", { name: p.defaultDisplayName })}</span>
      </label>
      <dl className="facts">
        <div>
          <dt>{t("acc_email")}</dt>
          <dd>
            {p.email}
            <span className="muted small field-hint">{t("acc_email_locked")}</span>
          </dd>
        </div>
        <div>
          <dt>{t("acc_phone")}</dt>
          <dd>
            {p.phone ?? <span className="muted">{t("acc_phone_none")}</span>}
            {p.phone && <span className="muted small field-hint">{p.phoneVerified ? <><Icon name="check" size={14} /> {t("acc_phone_confirmed")}</> : t("acc_phone_unconfirmed")}</span>}
          </dd>
        </div>
      </dl>
      {save.isError && <p className="notice notice-error" role="alert">{t("error_generic")}</p>}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={save.isPending || !dirty || !form.firstName.trim()}>
          {save.isPending ? t("acc_saving") : t("acc_save")}
        </button>
        {saved && !dirty && <span className="muted icon-line" role="status"><Icon name="check" size={16} />{t("acc_saved")}</span>}
      </div>
    </form>
  );
}

function Privacy({ p, t }: { p: Profile; t: T }) {
  const save = useSavePrivacy();
  const id = useId();
  // The switch moves the moment it's touched and goes back if the change is refused.
  const [on, setOn] = useState(p.leaderboardVisible);
  const change = (next: boolean) => {
    setOn(next);
    save.mutate(next, { onError: () => setOn(!next) });
  };
  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("acc_privacy")}</h2>
      <label className="choice">
        <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} aria-describedby={`${id}-hint`} />
        <span>{t("acc_leaderboard_toggle")}</span>
      </label>
      <p className="muted small" id={`${id}-hint`}>{t("acc_leaderboard_hint")}</p>
      {save.isError && <p className="notice notice-error" role="alert">{t("error_generic")}</p>}
    </section>
  );
}

function YourData({ t }: { t: T }) {
  const download = useDownloadData();
  const remove = useDeleteAccount();
  const id = useId();
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const lastOwner = (remove.error as { code?: string } | null)?.code === "last_owner";
  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("acc_data")}</h2>
      <p className="muted small">{t("acc_download_hint")}</p>
      <div className="actions">
        <button type="button" className="button" disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? t("loading") : t("acc_download")}
        </button>
        {!deleting && (
          <button type="button" className="button button-danger" onClick={() => setDeleting(true)}>
            {t("acc_delete")}
          </button>
        )}
      </div>
      {download.isError && <p className="notice notice-error" role="alert">{t("error_generic")}</p>}
      {deleting && (
        <form
          className="stack delete-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <p>{t("acc_delete_confirm")}</p>
          <label className="field">
            <span>{t("acc_delete_type")}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          </label>
          {remove.isError && <p className="notice notice-error" role="alert">{lastOwner ? t("acc_delete_last_owner") : t("error_generic")}</p>}
          <div className="actions">
            <button type="submit" className="button button-danger" disabled={typed.trim().toUpperCase() !== "DELETE" || remove.isPending}>
              {remove.isPending ? t("loading") : t("acc_delete")}
            </button>
            <button type="button" className="button button-quiet" onClick={() => { setDeleting(false); setTyped(""); remove.reset(); }}>
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** The account cards, once the account has loaded (a quiet line until then). */
export function AccountCards() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const profile = useProfile();
  if (!profile.data) {
    return profile.isError ? (
      <LoadError onRetry={() => void profile.refetch()} />
    ) : (
      <p className="muted" role="status">{t("loading")}</p>
    );
  }
  const p = profile.data;
  return (
    <>
      <Photo p={p} t={t} />
      <Details p={p} t={t} />
      <Privacy p={p} t={t} />
      <YourData t={t} />
    </>
  );
}
