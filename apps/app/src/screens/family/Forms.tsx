// The club's forms and waivers for a child: read one, then sign it by typing
// your own name. A form the club has reworded asks for a new signature.
import { useId, useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { useLang } from "../../hooks.tsx";
import { useChildForms, useSignForm, type ChildForm } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
const dateOf = (iso: string, lang: string) => new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

function FormDialog({ childId, childName, form, nameMax, ft, onClose }: { childId: number; childName: string; form: ChildForm; nameMax: number; ft: FamilyT; onClose: () => void }) {
  const id = useId();
  const lang = useLang();
  const sign = useSignForm(childId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(ft("err_name_required"));
    setError(null);
    sign.mutate({ formId: form.id, name: name.trim() }, { onSuccess: onClose, onError: (err) => setError(ft(errorKey(codeOf(err)))) });
  };
  return (
    <Dialog label={form.title} onClose={onClose}>
      <h2>{form.title}</h2>
      <div className="stack" data-form-body>
        {form.body.split(/\n{2,}/).map((para, i) => (
          <p key={i} style={{ whiteSpace: "pre-wrap" }}>{para}</p>
        ))}
      </div>
      {form.signedAt ? (
        <p className="notice" role="status">{ft("forms_signed_by", { name: form.signedName ?? "", date: dateOf(form.signedAt, lang) })}</p>
      ) : (
        <form className="stack" onSubmit={submit} noValidate data-form="sign-form">
          <p className="muted small">{ft("forms_sign_hint", { child: childName })}</p>
          <label className="field" htmlFor={`${id}-name`}>
            {ft("forms_name_label")}
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={nameMax} autoComplete="name" />
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div><button type="submit" className="button button-primary" disabled={sign.isPending}>{sign.isPending ? ft("forms_signing") : ft("forms_sign")}</button></div>
        </form>
      )}
      <div><button type="button" className="button button-quiet" onClick={onClose}>{ft("forms_close")}</button></div>
    </Dialog>
  );
}

export function ChildFormsPart({ childId, childName, ft }: { childId: number; childName: string; ft: FamilyT }) {
  const lang = useLang();
  const forms = useChildForms(childId);
  const [open, setOpen] = useState<number | null>(null);
  const list = forms.data?.forms ?? [];
  // A club that asks for nothing shows nothing.
  if (!forms.data || list.length === 0) return null;
  const unsigned = list.filter((f) => !f.signedAt).length;
  const shown = list.find((f) => f.id === open) ?? null;
  return (
    <fieldset className="stack" data-forms={childId}>
      <legend className="label-title">{ft("forms_title")}</legend>
      <p className="muted small" data-forms-status>{unsigned ? ft("forms_to_sign", { n: unsigned }) : ft("forms_all_signed")}</p>
      {list.map((f) => (
        <div className="row" key={f.id} data-form-row={f.slug} data-signed={f.signedAt ? "yes" : "no"}>
          <span className="row-text">
            <strong>{f.title}</strong>
            {f.signedAt && <span className="muted small">{ft("forms_signed_by", { name: f.signedName ?? "", date: dateOf(f.signedAt, lang) })}</span>}
          </span>
          <button type="button" className={f.signedAt ? "button button-quiet" : "button button-primary"} onClick={() => setOpen(f.id)}>{f.signedAt ? ft("forms_view") : ft("forms_read")}</button>
        </div>
      ))}
      {shown && <FormDialog childId={childId} childName={childName} form={shown} nameMax={forms.data.limits.nameMax} ft={ft} onClose={() => setOpen(null)} />}
    </fieldset>
  );
}
