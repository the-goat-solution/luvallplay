"use client";

import { useApp } from "@/context/AppContext";

export function RequestNewCancelLinkButton() {
  const { setOpenModal } = useApp();
  return (
    <button
      type="button"
      onClick={() => setOpenModal("cancel")}
      style={{
        color: "var(--navy)",
        fontWeight: 600,
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        cursor: "pointer",
        textDecoration: "underline",
      }}
    >
      Request a new one
    </button>
  );
}
