"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { useAdminText } from "@/components/admin/AdminLang";

export type FillInValue = {
  name: string;
  email: string;
  phone: string | null;
};

const inputStyle = {
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "#666",
  marginBottom: 3,
};

// Splits a stored "First Last" display name back into the two fields the
// form edits. Everything after the first space is the surname, so
// double-barrelled and multi-word surnames survive a round trip.
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const gap = trimmed.indexOf(" ");
  if (gap === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, gap),
    lastName: trimmed.slice(gap + 1).trim(),
  };
}

// "Add stand-in" / "Edit stand-in" control for one roster row (a stand-in,
// or fill-in, takes the place of a player who can't make it). The popup collects
// the same four fields as the cash-player form; saving and clearing are
// Server Actions the play-days page binds to this row's date and player
// before passing them down.
export function FillInButton({
  playerName,
  existing,
  saveAction,
  removeAction,
}: {
  playerName: string;
  existing: FillInValue | null;
  saveAction: (formData: FormData) => void;
  removeAction: () => void;
}) {
  const { t } = useAdminText();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape and lock background scrolling while the popup is up —
  // the admin tables are long, and a scrolling page behind a modal makes it
  // easy to lose track of which row is being edited.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const initial = existing ? splitName(existing.name) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid #184467",
          background: "#fff",
          color: "#184467",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {existing ? t("fill_edit") : t("fill_add")}
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("fill_dialog_label", { name: playerName })}
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: 20,
              width: "100%",
              maxWidth: 420,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>
              {existing ? t("fill_title_edit", { name: playerName }) : t("fill_title_add", { name: playerName })}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "#666",
                margin: "0 0 16px",
                lineHeight: 1.5,
              }}
            >
              {t("fill_intro_a")}<strong>{playerName}</strong>{t("fill_intro_b")}
            </p>

            <form action={saveAction}>
              <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="fill-in-first-name">
                      {t("play_first_name")}
                    </label>
                    <input
                      id="fill-in-first-name"
                      name="firstName"
                      required
                      defaultValue={initial?.firstName ?? ""}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="fill-in-last-name">
                      {t("play_last_name")}
                    </label>
                    <input
                      id="fill-in-last-name"
                      name="lastName"
                      required
                      defaultValue={initial?.lastName ?? ""}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle} htmlFor="fill-in-email">
                    {t("play_email")}
                  </label>
                  <input
                    id="fill-in-email"
                    name="email"
                    type="email"
                    required
                    defaultValue={existing?.email ?? ""}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="fill-in-phone">
                    {t("fill_phone")}
                  </label>
                  <input
                    id="fill-in-phone"
                    name="phone"
                    defaultValue={existing?.phone ?? ""}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "1px solid #ccc",
                    background: "#fff",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {t("common_cancel")}
                </button>
                <SubmitButton
                  loadingText={t("common_saving")}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "1px solid #184467",
                    background: "#184467",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {existing ? t("fill_save") : t("fill_add")}
                </SubmitButton>
              </div>
            </form>

            {existing ? (
              // Separate form: a nested <form> is invalid HTML, and this
              // submits a different Server Action to the same row.
              <form
                action={removeAction}
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid #eee",
                }}
              >
                <SubmitButton
                  loadingText={t("play_removing")}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid #a12622",
                    background: "#fff",
                    color: "#a12622",
                    fontSize: 12,
                  }}
                >
                  {t("fill_remove", { name: playerName })}
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
