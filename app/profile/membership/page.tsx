import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

export default function Page() {
  return (
    <h1 className={styles.pageTitle}>
      <PT k="tab_membership" />
    </h1>
  );
}
