"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/admin/SubmitButton";
import {
  FINANCE_CATEGORIES,
  FINANCE_METHODS,
  type FinanceKind,
} from "@/lib/finance";
import styles from "./financials.module.css";

// On a validation error the action echoes back what was submitted: React
// resets a form after its action runs, and these become the reset values so
// the admin doesn't have to retype everything.
export type EntryFormState = { error?: string; values?: Record<string, string> };

export type EntryFormInitial = {
  id: number;
  kind: FinanceKind;
  name: string;
  category: string;
  method: string | null;
  person: string | null;
  entryDate: string;
  amount: string;
  notes: string | null;
  hasReceipt: boolean;
  receiptIsImage: boolean;
};

// Longest edge for an uploaded receipt photo. Plenty to read a till slip,
// and turns a 4–8 MB phone photo into a few hundred KB.
const MAX_IMAGE_EDGE = 2000;

// Shrinks a phone photo in the browser before upload, so it fits the
// request size limit and storage stays small. Anything the browser can't
// decode (e.g. HEIC outside Safari) or that's already small goes up as-is.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size < 600 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function EntryForm({
  action,
  initial,
  today,
  people,
  receiptsEnabled,
  returnTo,
  cancelHref,
  defaultOpen,
}: {
  action: (state: EntryFormState, formData: FormData) => Promise<EntryFormState>;
  initial: EntryFormInitial | null;
  today: string;
  people: string[];
  receiptsEnabled: boolean;
  returnTo: string;
  cancelHref: string;
  defaultOpen: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<FinanceKind>(initial?.kind ?? "spent");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const v = state.values;

  const editing = Boolean(initial);

  useEffect(() => {
    if (defaultOpen) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [defaultOpen, initial?.id]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const categories = FINANCE_CATEGORIES.filter((c) => c.kind === kind);

  async function onFile(input: HTMLInputElement) {
    const original = input.files?.[0];
    setPreview(null);
    setFileNote(null);
    if (!original) return;
    const file = await compressImage(original);
    if (file !== original) {
      // Swap the compressed file into the input so the form submits it.
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFileNote("This file is over 4 MB — please choose a smaller one.");
    } else {
      setFileNote(`${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`);
    }
    if (file.type.startsWith("image/") && file.type !== "image/heic") {
      setPreview(URL.createObjectURL(file));
    }
    setRemoveReceipt(false);
  }

  if (!open) {
    return (
      <div className={styles.addRow}>
        <button type="button" className={styles.buttonPrimary} onClick={() => setOpen(true)}>
          + Record expense or income
        </button>
      </div>
    );
  }

  return (
    <div ref={panelRef} className={styles.formPanel}>
      <div className={styles.formHead}>
        <h2 className={styles.formTitle}>
          {editing ? "Edit entry" : kind === "spent" ? "Record money spent" : "Record money received"}
        </h2>
        {editing ? (
          <a href={cancelHref} className={styles.buttonGhost}>
            Cancel
          </a>
        ) : (
          <button type="button" className={styles.buttonGhost} onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </div>

      <form action={formAction}>
        {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="kind" value={kind} />

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <span className={styles.label}>Type</span>
            <div className={styles.segmented} role="group" aria-label="Type">
              {(["spent", "received"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  className={`${styles.segment} ${k === "spent" ? styles.segmentSpent : styles.segmentReceived} ${kind === k ? styles.segmentActive : ""}`}
                  onClick={() => {
                    setKind(k);
                    if (!FINANCE_CATEGORIES.some((c) => c.value === category && c.kind === k)) {
                      setCategory("");
                    }
                  }}
                >
                  {k === "spent" ? "Spent" : "Received"}
                </button>
              ))}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Date *</span>
            <input
              type="date"
              name="entryDate"
              required
              className={styles.input}
              defaultValue={v?.entryDate ?? initial?.entryDate ?? today}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Amount (NZD) *</span>
            <span className={styles.amountWrap}>
              <span className={styles.amountPrefix}>$</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                pattern="^\$?\s*[0-9][0-9,]*(\.[0-9]{1,2})?$"
                title="An amount like 45 or 45.50"
                className={`${styles.input} ${styles.num}`}
                defaultValue={v?.amount ?? initial?.amount ?? ""}
              />
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Paid {kind === "spent" ? "with" : "by"}</span>
            <select
              name="method"
              className={styles.select}
              defaultValue={v?.method ?? initial?.method ?? "bank_transfer"}
            >
              {FINANCE_METHODS.filter((m) => m.value !== "stripe").map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`${styles.field} ${styles.span2}`}>
            <span className={styles.label}>Name / description *</span>
            <input
              name="name"
              required
              maxLength={200}
              className={styles.input}
              placeholder={kind === "spent" ? "e.g. Court hire — Pioneer Stadium, October" : "e.g. Sponsorship — Joe's Bakery"}
              defaultValue={v?.name ?? initial?.name ?? ""}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Source *</span>
            <select
              name="category"
              required
              className={styles.select}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="" disabled>
                Choose…
              </option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Associated person</span>
            <input
              name="person"
              maxLength={200}
              list="finance-people"
              autoComplete="off"
              className={styles.input}
              placeholder={kind === "spent" ? "Who paid / was reimbursed" : "Who it came from"}
              defaultValue={v?.person ?? initial?.person ?? ""}
            />
            <datalist id="finance-people">
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>

          <label className={`${styles.field} ${styles.span2}`}>
            <span className={styles.label}>Notes</span>
            <textarea
              name="notes"
              rows={2}
              maxLength={1000}
              className={styles.textarea}
              placeholder="Anything the treasurer should know — invoice number, what it covered…"
              defaultValue={v?.notes ?? initial?.notes ?? ""}
            />
          </label>

          <div className={`${styles.field} ${styles.span2}`}>
            <span className={styles.label}>Invoice / receipt image</span>
            {receiptsEnabled ? (
              <div className={styles.receiptBox}>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Receipt preview" className={styles.receiptPreview} />
                ) : initial?.hasReceipt && !removeReceipt ? (
                  initial.receiptIsImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/admin/finance/receipts/${initial.id}`}
                      alt="Current receipt"
                      className={styles.receiptPreview}
                    />
                  ) : (
                    <span className={styles.fileChip}>PDF</span>
                  )
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <input
                    type="file"
                    name="receipt"
                    accept="image/*,application/pdf"
                    onChange={(e) => onFile(e.currentTarget)}
                  />
                  <span className={styles.hint}>
                    {fileNote ??
                      (initial?.hasReceipt
                        ? "Choose a file to replace the current receipt."
                        : "Photo or PDF, up to 4 MB. Phone photos are shrunk automatically.")}
                  </span>
                  {initial?.hasReceipt && !preview ? (
                    <label className={styles.hint}>
                      <input
                        type="checkbox"
                        name="removeReceipt"
                        checked={removeReceipt}
                        onChange={(e) => setRemoveReceipt(e.target.checked)}
                      />{" "}
                      Remove current receipt
                    </label>
                  ) : null}
                </div>
              </div>
            ) : (
              <span className={styles.hint}>
                Receipt uploads need Vercel Blob storage — see README (BLOB_READ_WRITE_TOKEN).
              </span>
            )}
          </div>
        </div>

        {state.error ? (
          <p className={styles.formError} role="alert">
            {state.error}
          </p>
        ) : null}

        <div className={styles.formActions}>
          {editing ? (
            <a href={cancelHref} className={styles.button}>
              Cancel
            </a>
          ) : null}
          <SubmitButton loadingText="Saving…" className={styles.buttonPrimary}>
            {editing ? "Save changes" : kind === "spent" ? "Add expense" : "Add income"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
