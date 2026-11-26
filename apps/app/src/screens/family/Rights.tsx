// A guardian's rights over a child's information: download all of it, or
// delete it for good (asked twice: the button, then the dialog).
import { useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { saveFile } from "../../lib/native/files.ts";
import { useDeleteChild, useExportChild } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

export function ChildRights({ childId, childName, ft, onDeleted }: { childId: number; childName: string; ft: FamilyT; onDeleted: (name: string) => void }) {
  const exporting = useExportChild(childId);
  const deleting = useDeleteChild(childId);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const download = () => {
    setMessage(null);
    exporting.mutate(undefined, {
      onSuccess: async (data) => {
        try {
          await saveFile("child-information.json", JSON.stringify(data, null, 2), "application/json");
          setMessage({ ok: true, text: ft("rights_exported") });
        } catch {
          setMessage({ ok: false, text: ft("err_generic") });
        }
      },
      onError: (err) => setMessage({ ok: false, text: ft(errorKey(codeOf(err))) }),
    });
  };
  const remove = () => {
    setMessage(null);
    deleting.mutate(undefined, {
      onSuccess: () => onDeleted(childName),
      onError: (err) => (setAsking(false), setMessage({ ok: false, text: ft(errorKey(codeOf(err))) })),
    });
  };
  return (
    <div className="stack" data-rights={childId}>
      <div className="row">
        <span className="row-text">
          <strong>{ft("rights_title")}</strong>
          <span className="muted small">{ft("rights_hint", { child: childName })}</span>
        </span>
      </div>
      <div className="row">
        <button type="button" className="button button-quiet" disabled={exporting.isPending} onClick={download}>{exporting.isPending ? ft("rights_exporting") : ft("rights_export")}</button>
        <button type="button" className="button button-quiet button-danger" onClick={() => setAsking(true)}>{ft("rights_delete")}</button>
      </div>
      {message && <p className={message.ok ? "notice" : "notice notice-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {asking && (
        <Dialog label={ft("rights_delete_title", { child: childName })} onClose={() => setAsking(false)}>
          <h2>{ft("rights_delete_title", { child: childName })}</h2>
          <p>{ft("rights_delete_body", { child: childName })}</p>
          <div className="row">
            <button type="button" className="button button-quiet" onClick={() => setAsking(false)}>{ft("rights_cancel")}</button>
            <button type="button" className="button button-danger" disabled={deleting.isPending} onClick={remove}>{deleting.isPending ? ft("rights_deleting") : ft("rights_delete_confirm")}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
