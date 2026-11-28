// The first sign-in of a brand-new account: just a name, as on the website's
// /login/details. Skippable (the reminder stays until a name is saved).
import { useState, type FormEvent } from "react";
import { useRouter, useSearch } from "@tanstack/react-router";
import { store } from "../app.ts";
import { appNext } from "../lib/next-path.ts";
import { useCurrentClub, useT } from "../hooks.tsx";
import { useSaveDetails } from "./settings/data.ts";

export default function Welcome() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const router = useRouter();
  // The screen asked for before sign-in, if any (lib/next-path.ts); Home otherwise.
  const { next } = useSearch({ from: "/shell/welcome" });
  const after = appNext(next);
  const save = useSaveDetails();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { firstName: firstName.trim(), lastName: lastName.trim(), displayName: null },
      {
        onSuccess: () => {
          store.set({ needsDetails: false });
          router.history.replace(after);
        },
      },
    );
  };
  return (
    <div className="screen" data-screen="welcome">
      <form className="card stack narrow" onSubmit={submit} aria-labelledby="welcome-title">
        <h1 id="welcome-title">{t("name_step_title")}</h1>
        <p className="muted">{t("name_step_lead")}</p>
        <label className="field">
          <span>{t("acc_first_name")}</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} autoComplete="given-name" autoFocus />
        </label>
        <label className="field">
          <span>{t("acc_last_name")}</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} autoComplete="family-name" />
        </label>
        {save.isError && <p className="notice notice-error" role="alert">{t("error_generic")}</p>}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={save.isPending || !firstName.trim()}>
            {save.isPending ? t("acc_saving") : t("name_step_save")}
          </button>
          <button type="button" className="button button-quiet" onClick={() => router.history.replace(after)}>{t("cancel")}</button>
        </div>
      </form>
    </div>
  );
}
