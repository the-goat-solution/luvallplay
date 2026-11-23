import { Navigation } from "@/components/Navigation";
import { LoadingIcon } from "@/components/LoadingIcon";

// Shown while the gallery loads.
export default function Loading() {
  return (
    <>
      <Navigation />
      <main
        role="status"
        aria-live="polite"
        style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "#666", fontSize: 14 }}
      >
        <LoadingIcon size="md" />
        Loading…
      </main>
    </>
  );
}
