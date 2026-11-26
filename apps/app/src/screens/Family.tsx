// Family (from My profile, when the club has Juniors on): a guardian's own
// children in this club. Children never sign in: the guardian adds them here
// and decides, item by item, what the club may show (build plan §6.8).
import { useId, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Icon } from "../components/Icon.tsx";
import { LoadError } from "../components/LoadError.tsx";
import { useCurrentClub, useT } from "../hooks.tsx";
import { ChildBookings } from "./family/Bookings.tsx";
import { CONSENT_ITEMS, useAddChild, useFamily, useFamilyBookings, useFamilyOn, useSetConsent, useUpdateChild, type Child, type Consent, type Family, type FamilyBookings } from "./family/data.ts";
import { errorKey, useFamilyT, type FamilyT } from "./family/words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

function years(limits: Family["limits"]): number[] {
  const out: number[] = [];
  for (let y = limits.birthYearMax; y >= limits.birthYearMin; y--) out.push(y);
  return out;
}

function ConsentChoices({ value, onChange, ft, idPrefix }: { value: Consent; onChange: (item: keyof Consent, on: boolean) => void; ft: FamilyT; idPrefix: string }) {
  return (
    <>
      {CONSENT_ITEMS.map((item) => (
        <div key={item}>
          <label className="choice">
            <input type="checkbox" checked={value[item]} onChange={(e) => onChange(item, e.target.checked)} aria-describedby={`${idPrefix}-${item}`} data-consent={item} />
            <span>{ft(`consent_${item}`)}</span>
          </label>
          <p className="muted small" id={`${idPrefix}-${item}`}>{ft(`consent_${item}_hint`)}</p>
        </div>
      ))}
    </>
  );
}

function AddChild({ family, clubName, ft, onDone }: { family: Family; clubName: string; ft: FamilyT; onDone: (name: string) => void }) {
  const add = useAddChild();
  const id = useId();
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [consent, setConsent] = useState<Consent>({ leaderboard: false, photos: false, vision: false });
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The same checks the server makes, said before the request.
    if (!name.trim()) return setError(ft("err_name_required"));
    if (!birthYear) return setError(ft("err_birth_year"));
    if (!confirmed) return setError(ft("err_consent_required"));
    setError(null);
    add.mutate(
      { name: name.trim(), birthYear: Number(birthYear), guardianConfirmed: true, consent },
      { onSuccess: (r) => onDone(r.child.name), onError: (err) => setError(ft(errorKey(codeOf(err)))) },
    );
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate data-form="family-add" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{ft("family_add")}</h2>
      <label className="field">
        {ft("family_name")}
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={family.limits.nameMax} autoComplete="off" aria-describedby={`${id}-name-hint`} />
        <span className="field-hint" id={`${id}-name-hint`}>{ft("family_name_hint")}</span>
      </label>
      <label className="field">
        {ft("family_birth_year")}
        <select name="birthYear" value={birthYear} onChange={(e) => setBirthYear(e.target.value)}>
          <option value="">{ft("family_birth_year_choose")}</option>
          {years(family.limits).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </label>
      <fieldset className="stack">
        <legend className="label-title">{ft("family_optional_title")}</legend>
        <p className="muted small">{ft("family_optional_hint")}</p>
        <ConsentChoices value={consent} onChange={(item, on) => setConsent((c) => ({ ...c, [item]: on }))} ft={ft} idPrefix={`${id}-c`} />
      </fieldset>
      <label className="choice">
        <input type="checkbox" name="guardianConfirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{ft("family_confirm", { club: clubName })}</span>
      </label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={add.isPending}>{add.isPending ? ft("family_saving") : ft("family_save")}</button>
    </form>
  );
}

function ChildCard({ child, family, bookings, ft }: { child: Child; family: Family; bookings: FamilyBookings | undefined; ft: FamilyT }) {
  const id = useId();
  const update = useUpdateChild(child.id);
  const consent = useSetConsent(child.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(child.name);
  const [birthYear, setBirthYear] = useState(String(child.birthYear));
  const [error, setError] = useState<string | null>(null);
  // A switch moves the moment it's touched and goes back if the change is refused.
  const [shown, setShown] = useState<Consent>(child.consent);
  const change = (item: keyof Consent, on: boolean) => {
    setShown((c) => ({ ...c, [item]: on }));
    consent.mutate({ [item]: on }, { onSuccess: (r) => setShown(r.child.consent), onError: () => setShown((c) => ({ ...c, [item]: !on })) });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(ft("err_name_required"));
    setError(null);
    update.mutate({ name: name.trim(), birthYear: Number(birthYear) }, { onSuccess: () => setEditing(false), onError: (err) => setError(ft(errorKey(codeOf(err)))) });
  };
  // A child whose year is no longer offered (they turned 16) still shows it.
  const yearList = years(family.limits).includes(child.birthYear) ? years(family.limits) : [child.birthYear, ...years(family.limits)];
  return (
    <section className="card stack" aria-labelledby={`${id}-name`} data-child={child.id}>
      <div className="card-head">
        <div>
          <h2 className="title" id={`${id}-name`}>{child.name}</h2>
          <p className="muted small">
            {ft("family_born", { year: child.birthYear })}
            {child.guardians > 1 ? ` · ${ft("family_guardians_two")}` : ""}
          </p>
        </div>
        {!editing && <button type="button" className="button button-quiet" onClick={() => setEditing(true)}>{ft("family_edit")}</button>}
      </div>
      {editing && (
        <form className="stack" onSubmit={save} noValidate data-form="family-edit">
          <label className="field">
            {ft("family_name")}
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={family.limits.nameMax} autoComplete="off" />
          </label>
          <label className="field">
            {ft("family_birth_year")}
            <select name="birthYear" value={birthYear} onChange={(e) => setBirthYear(e.target.value)}>
              {yearList.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="row">
            <button type="submit" className="button button-primary" disabled={update.isPending}>{update.isPending ? ft("family_saving") : ft("family_save")}</button>
            <button type="button" className="button button-quiet" onClick={() => { setEditing(false); setName(child.name); setBirthYear(String(child.birthYear)); setError(null); }}>{ft("family_cancel")}</button>
          </div>
        </form>
      )}
      {bookings && <ChildBookings childId={child.id} data={bookings} ft={ft} />}
      <fieldset className="stack">
        <legend className="label-title">{ft("family_optional_title")}</legend>
        <p className="muted small">{ft("family_optional_hint")}</p>
        <ConsentChoices value={shown} onChange={change} ft={ft} idPrefix={`${id}-c`} />
        {consent.isError && <p className="notice notice-error" role="alert">{ft(errorKey(codeOf(consent.error)))}</p>}
      </fieldset>
    </section>
  );
}

export default function FamilyScreen() {
  const { config, current } = useCurrentClub();
  const t = useT(config);
  const ft = useFamilyT();
  const on = useFamilyOn();
  const state = useFamily();
  const family = state.data;
  const bookings = useFamilyBookings().data;
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const clubName = current?.name ?? "";
  // Off for this club (or switched off since the list was read): say so, show nothing else.
  const off = (!!config && !on) || codeOf(state.error) === "module_off";
  const full = !!family && family.children.length >= family.limits.maxChildren;
  return (
    <div className="screen stack" data-screen="family" data-state={off ? "off" : family ? "ready" : state.isError ? "error" : "loading"}>
      <Link to="/profile" className="back"><Icon name="chevronLeft" size={20} />{t("nav_profile")}</Link>
      <h1>{ft("family_title")}</h1>
      {off ? (
        <p className="notice">{ft("family_off")}</p>
      ) : !family ? (
        state.isError ? <LoadError onRetry={() => void state.refetch()} /> : <div className="skeleton skeleton-tall" aria-busy="true" />
      ) : (
        <>
          <p className="muted">{ft("family_intro")}</p>
          {added && <p className="notice" role="status">{ft("family_added", { name: added })}</p>}
          {family.children.length === 0 && !adding && <p className="muted">{ft("family_empty")}</p>}
          {family.children.map((child) => (
            <ChildCard key={child.id} child={child} family={family} bookings={bookings} ft={ft} />
          ))}
          {adding ? (
            <>
              <AddChild family={family} clubName={clubName} ft={ft} onDone={(name) => { setAdding(false); setAdded(name); }} />
              <button type="button" className="button button-quiet" onClick={() => setAdding(false)}>{ft("family_cancel")}</button>
            </>
          ) : full ? (
            <p className="muted small">{ft("family_limit", { n: family.limits.maxChildren })}</p>
          ) : (
            <button type="button" className="button button-primary" data-action="family-add" onClick={() => { setAdded(null); setAdding(true); }}>
              {family.children.length ? ft("family_add_another") : ft("family_add")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
