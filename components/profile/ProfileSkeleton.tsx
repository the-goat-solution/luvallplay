"use client";

import { useProfileT } from "@/lib/profile-i18n";
import styles from "./profile.module.css";

/** Shown while a profile tab loads (app/profile/loading.tsx). */
export function ProfileSkeleton() {
  const { tr } = useProfileT();
  return (
    <div aria-busy="true" aria-live="polite">
      <div className={styles.navBar} />
      <div className={styles.loadingLine}>
        <span className={styles.spinner} aria-hidden="true" />
        {tr("loading")}
      </div>
      <div className={styles.stack} style={{ marginTop: 12 }}>
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 220 }} />
        <div className={styles.skeleton} style={{ height: 160 }} />
      </div>
    </div>
  );
}
