"use client";

import { useProfileT } from "@/lib/profile-i18n";
import { ClubAdminButton } from "./MeHeader";
import styles from "../profile.module.css";
import m from "./me.module.css";

/** Settings: the way into club admin, for people with a club role. */
export function SettingsAdminCard() {
  const { tr } = useProfileT();
  return (
    <section className={styles.card}>
      <div className={styles.rowText} style={{ marginBottom: 10 }}>
        <strong>{tr("me_club_admin")}</strong>
        <span className={styles.small}>{tr("settings_admin_hint")}</span>
      </div>
      <ClubAdminButton className={m.adminBtn} />
    </section>
  );
}
