"use client";

import { useProfileT } from "@/lib/profile-i18n";
import type { ThreadSummary } from "@/lib/messages-db";
import { openInbox } from "./MeHeader";
import styles from "../profile.module.css";
import m from "./me.module.css";

/** Right column on tablets: the latest conversations; a tap opens the inbox at that thread. */
export function InboxPreview({ threads }: { threads: ThreadSummary[] }) {
  const { tr } = useProfileT();
  const latest = threads.slice(0, 3);
  return (
    <section className={`${styles.card} ${m.inboxPreview}`} aria-labelledby="inbox-preview-title">
      <h2 id="inbox-preview-title" className={styles.cardTitle}>
        {tr("me_inbox_preview")}
      </h2>
      {latest.length === 0 ? (
        <p className={styles.muted}>{tr("me_inbox_none")}</p>
      ) : (
        <ul className={m.previewList}>
          {latest.map((t) => (
            <li key={t.id} className={t.unread ? m.unread : undefined}>
              <button type="button" className={m.previewItem} onClick={() => openInbox(t.id)}>
                <strong>{t.subject}</strong>
                <span>{t.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} onClick={() => openInbox()}>
        {tr("me_inbox_open")}
      </button>
    </section>
  );
}
