import type { ReactNode } from "react";
import styles from "./profile.module.css";

/** A button's label, with a spinner (and optional text) while it's working. */
export function BusyLabel({ busy, children, busyText }: { busy: boolean; children: ReactNode; busyText?: ReactNode }) {
  if (!busy) return <>{children}</>;
  return (
    <>
      <span className={styles.spinner} aria-hidden="true" />
      <span>{busyText ?? children}</span>
    </>
  );
}

/** A small inline spinner for non-button places (lists, rows, links). */
export function Spinner({ label }: { label?: string }) {
  return <span className={styles.spinner} role="status" aria-label={label ?? "Loading"} />;
}
