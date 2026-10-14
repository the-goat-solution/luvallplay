import { SubmitButton } from "@/components/admin/SubmitButton";
import styles from "./financials.module.css";

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
      <SubmitButton
        loadingText="Deleting…"
        className={`${styles.actionLink} ${styles.actionDanger}`}
        confirmMessage={`Delete "${label}"? This can't be undone.`}
      >
        Delete
      </SubmitButton>
    </form>
  );
}
