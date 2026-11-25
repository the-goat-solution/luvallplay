// The top of Me: picture or initials, name, the membership pill and the
// inbox bell with its unread count (it opens the inbox), as on the website.
import { Link } from "@tanstack/react-router";
import type { Me } from "./data.ts";
import { dayLabel } from "../../lib/format.ts";
import { usePlace } from "./parts.tsx";

function pillText(me: Me, t: ReturnType<typeof usePlace>["t"], locale: string): { text: string; active: boolean } {
  const m = me.membership;
  if (!m) return { text: t("me_pill_none"), active: false };
  if (m.autoRenews && m.periodEnd) return { text: t("me_pill_renews", { date: dayLabel(m.periodEnd, locale) }), active: true };
  // A paid follow-on membership carries them on: the pill shows when that one ends (as on the website).
  const end = m.next?.periodEnd ?? m.periodEnd;
  return end ? { text: t("me_pill_ends", { date: dayLabel(end, locale) }), active: true } : { text: t("me_pill_active"), active: true };
}

export function MeHeader({ me }: { me: Me }) {
  const { t, locale } = usePlace();
  const name = `${me.player.firstName} ${me.player.lastName}`.trim() || me.player.displayName;
  const pill = pillText(me, t, locale);
  const unread = me.inbox.unread;
  return (
    <header className="me-head">
      <div className="avatar" aria-hidden="true">
        {me.player.avatarUrl ? <img src={me.player.avatarUrl} alt="" width={64} height={64} /> : me.player.initials}
      </div>
      <div className="me-who">
        <h1>{name}</h1>
        <span className={`pill${pill.active ? " pill-active" : ""}`}>{pill.text}</span>
      </div>
      <Link
        to="/inbox"
        className="icon-button"
        aria-label={unread > 0 ? `${t("me_inbox")}, ${t("me_inbox_unread", { n: unread })}` : t("me_inbox")}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </Link>
    </header>
  );
}
