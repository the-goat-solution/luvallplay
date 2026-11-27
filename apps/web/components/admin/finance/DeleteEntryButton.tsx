import { SubmitButton } from "@/components/admin/SubmitButton";
import styles from "./financials.module.css";
import { adminText } from "@/lib/admin-lang";

// Delete for a manual ledger entry, behind a confirm — a mis-click on a
// finance record shouldn't silently change the club's totals.
export async function DeleteEntryButton({
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
  const { t } = await adminText();
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton
        loadingText={t("fin_deleting")}
        className={`${styles.actionLink} ${styles.actionDanger}`}
        confirmMessage={t("fin_delete_confirm", { name: label })}
      >
        {t("fin_delete")}
      </SubmitButton>
    </form>
  );
}
