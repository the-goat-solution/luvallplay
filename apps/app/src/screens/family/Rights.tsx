// A guardian's rights over a child's information: download all of it, or
// ask the club to delete it. Deleting is confirmed by an owner or admin of
// the club; until then nothing is removed and the request can be withdrawn.
import { useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { useLang } from "../../hooks.tsx";
import { saveFile } from "../../lib/native/files.ts";
import { useExportChild, useRequestDelete } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;
const dateOf = (iso: string, lang: string) => new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function ChildRights({ childId, childName, requestedAt, ft }: { childId: number; childName: string; requestedAt: string | null; ft: FamilyT }) {
  const lang = useLang();
  const exporting = useExportChild(childId);
  const { ask, withdraw } = useRequestDelete(childId);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const failed = (err: unknown) => setMessage({ ok: false, text: ft(errorKey(codeOf(err))) });
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
      onError: failed,
    });
  };
  const request = () => {
    setMessage(null);
    ask.mutate(undefined, { onSuccess: () => (setAsking(false), setMessage({ ok: true, text: ft("rights_deleted", { child: childName }) })), onError: (err) => (setAsking(false), failed(err)) });
  };
  return (
    <div className="stack" data-rights={childId} data-deletion={requestedAt ? "requested" : "none"}>
      <div className="row">
        <span className="row-text">
          <strong>{ft("rights_title")}</strong>
          <span className="muted small">{ft("rights_hint", { child: childName })}</span>
        </span>
      </div>
      {requestedAt && <p className="notice">{ft("rights_waiting", { date: dateOf(requestedAt, lang) })}</p>}
      <div className="row">
        <button type="button" className="button button-quiet" disabled={exporting.isPending} onClick={download}>{exporting.isPending ? ft("rights_exporting") : ft("rights_export")}</button>
        {requestedAt ? (
          <button type="button" className="button button-quiet" disabled={withdraw.isPending} onClick={() => (setMessage(null), withdraw.mutate(undefined, { onError: failed }))}>
            {withdraw.isPending ? ft("rights_withdrawing") : ft("rights_withdraw")}
          </button>
        ) : (
          <button type="button" className="button button-quiet button-danger" onClick={() => setAsking(true)}>{ft("rights_delete")}</button>
        )}
      </div>
      {message && <p className={message.ok ? "notice" : "notice notice-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {asking && (
        <Dialog label={ft("rights_delete_title", { child: childName })} onClose={() => setAsking(false)}>
          <h2>{ft("rights_delete_title", { child: childName })}</h2>
          <p>{ft("rights_delete_body", { child: childName })}</p>
          <div className="row">
            <button type="button" className="button button-quiet" onClick={() => setAsking(false)}>{ft("rights_cancel")}</button>
            <button type="button" className="button button-danger" disabled={ask.isPending} onClick={request}>{ask.isPending ? ft("rights_deleting") : ft("rights_delete_confirm")}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
