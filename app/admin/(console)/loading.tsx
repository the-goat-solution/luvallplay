import { LoadingIcon } from "@/components/LoadingIcon";
import adminStyles from "@/components/admin/admin.module.css";

// Shown while an admin page renders on the server after switching tabs.
// Same container as the pages so the layout doesn't jump when the real
// page arrives.
export default function AdminLoading() {
  return (
    <div className={adminStyles.page}>
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
