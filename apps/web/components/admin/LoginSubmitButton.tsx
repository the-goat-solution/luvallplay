"use client";

import { PlainSubmitButton } from "@/components/admin/PlainSubmitButton";

export function LoginSubmitButton() {
  return (
    <PlainSubmitButton
      loadingText="Logging in…"
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid #1a2a4a",
        background: "#1a2a4a",
        color: "#fff",
        fontSize: 14,
        justifyContent: "center",
      }}
    >
      Log in
    </PlainSubmitButton>
  );
}
