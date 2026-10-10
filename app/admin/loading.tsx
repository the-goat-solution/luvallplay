import { LoadingIcon } from "@/components/LoadingIcon";

// Shown while an admin page renders on the server after switching tabs
// (Play days / Members / Financials). Same container as the pages so the
// layout doesn't jump when the real page arrives.
export default function AdminLoading() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 860,
        margin: "40px auto",
        padding: "0 20px",
      }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          padding: "120px 0",
          color: "#666",
          fontSize: 14,
        }}
      >
        <LoadingIcon size="md" />
        Loading…
      </div>
    </div>
  );
}
