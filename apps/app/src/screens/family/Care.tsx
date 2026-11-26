// A child's safety details: who to call, and the medical note. Closed until
// the guardian opens it, so a medical note is fetched only when asked for.
import { useId, useState, type FormEvent } from "react";
import { useCare, useSaveContacts, useSaveNotes, type Care, type CareContact } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
type Row = { name: string; phone: string; relationship: string };
const rowsOf = (contacts: CareContact[]): Row[] => contacts.map((c) => ({ name: c.name, phone: c.phone, relationship: c.relationship ?? "" }));

function Contacts({ childId, care, ft }: { childId: number; care: Care; ft: FamilyT }) {
  const id = useId();
  const save = useSaveContacts(childId);
  const [rows, setRows] = useState<Row[]>(rowsOf(care.contacts));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (i: number, part: Partial<Row>) => setRows((r) => r.map((row, n) => (n === i ? { ...row, ...part } : row)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    save.mutate(
      rows.map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), relationship: r.relationship.trim() || null })),
      { onSuccess: (r) => (setRows(rowsOf(r.contacts)), setMessage({ ok: true, text: ft("care_contacts_saved") })), onError: (err) => setMessage({ ok: false, text: ft(errorKey(codeOf(err))) }) },
    );
  };
  return (
    <form className="stack" onSubmit={submit} noValidate data-form="care-contacts">
      <h3 className="label-title">{ft("care_contacts_title")}</h3>
      <p className="muted small">{ft("care_contacts_hint", { n: care.limits.contacts })}</p>
      {rows.map((row, i) => (
        <fieldset className="stack" key={i} data-contact={i + 1}>
          <legend className="muted small">{ft("care_contact_n", { n: i + 1 })}</legend>
          <label className="field" htmlFor={`${id}-n${i}`}>
            {ft("care_contact_name")}
            <input id={`${id}-n${i}`} value={row.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={care.limits.nameMax} autoComplete="off" />
          </label>
          <label className="field" htmlFor={`${id}-p${i}`}>
            {ft("care_contact_phone")}
            <input id={`${id}-p${i}`} type="tel" inputMode="tel" value={row.phone} onChange={(e) => set(i, { phone: e.target.value })} maxLength={24} autoComplete="off" />
          </label>
          <label className="field" htmlFor={`${id}-r${i}`}>
            {ft("care_contact_relationship")}
            <input id={`${id}-r${i}`} value={row.relationship} onChange={(e) => set(i, { relationship: e.target.value })} maxLength={care.limits.relationshipMax} autoComplete="off" />
          </label>
          <div><button type="button" className="button button-quiet" onClick={() => setRows((r) => r.filter((_, n) => n !== i))}>{ft("care_contact_remove")}</button></div>
        </fieldset>
      ))}
      <div className="row">
        {rows.length < care.limits.contacts && (
          <button type="button" className="button button-quiet" onClick={() => setRows((r) => [...r, { name: "", phone: "", relationship: "" }])}>{ft("care_contact_add")}</button>
        )}
        <button type="submit" className="button button-primary" disabled={save.isPending}>{save.isPending ? ft("care_saving") : ft("care_contacts_save")}</button>
      </div>
      {message && <p className={message.ok ? "notice" : "notice notice-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </form>
  );
}

function Notes({ childId, care, ft }: { childId: number; care: Care; ft: FamilyT }) {
  const id = useId();
  const save = useSaveNotes(childId);
  const [notes, setNotes] = useState(care.medicalNotes);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    save.mutate(notes, { onSuccess: (r) => (setNotes(r.medicalNotes), setMessage({ ok: true, text: ft("care_notes_saved") })), onError: (err) => setMessage({ ok: false, text: ft(errorKey(codeOf(err))) }) });
  };
  return (
    <form className="stack" onSubmit={submit} noValidate data-form="care-notes">
      <h3 className="label-title">{ft("care_notes_title")}</h3>
      <p className="muted small">{ft("care_notes_hint")}</p>
      {care.medicalNotesAvailable ? (
        <>
          <label className="field" htmlFor={`${id}-notes`}>
            {ft("care_notes_label")}
            <textarea id={`${id}-notes`} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={care.limits.notesMax} autoComplete="off" />
          </label>
          <div><button type="submit" className="button button-primary" disabled={save.isPending}>{save.isPending ? ft("care_saving") : ft("care_notes_save")}</button></div>
        </>
      ) : (
        <p className="notice">{ft("care_notes_unavailable")}</p>
      )}
      {message && <p className={message.ok ? "notice" : "notice notice-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </form>
  );
}

export function ChildCare({ childId, ft }: { childId: number; ft: FamilyT }) {
  const [open, setOpen] = useState(false);
  const care = useCare(childId, open);
  return (
    <div className="stack" data-care={childId}>
      <div className="row">
        <span className="row-text">
          <strong>{ft("care_title")}</strong>
          <span className="muted small">{ft("care_open")}</span>
        </span>
        <button type="button" className="button button-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? ft("care_hide") : ft("care_show")}</button>
      </div>
      {open && care.isPending && <p className="muted small">{ft("care_loading")}</p>}
      {open && care.isError && <p className="notice notice-error" role="alert">{ft(errorKey(codeOf(care.error)))}</p>}
      {open && care.data && (
        <>
          <Contacts childId={childId} care={care.data} ft={ft} />
          <Notes childId={childId} care={care.data} ft={ft} />
        </>
      )}
    </div>
  );
}
