"use client";

import { useFormStatus } from "react-dom";
import styles from "./financials.module.css";

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${styles.actionLink} ${styles.actionDanger}`}
      onClick={(e) => {
        if (!window.confirm(`Delete "${label}"? This can't be undone.`)) e.preventDefault();
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

// Delete for a manual ledger entry, behind a confirm — a mis-click on a
// finance record shouldn't silently change the club's totals.
export function DeleteEntryButton({
  action,
  id,
  label,
  returnTo,
}: {
  action: (formData: FormData) => Promise<void>;
  id: number;
  label: string;
  returnTo: string;
}) {
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button label={label} />
    </form>
  );
}
