"use client";

import styles from "./financials.module.css";

export function PrintButton() {
  return (
    <button type="button" className={styles.buttonPrimary} onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
