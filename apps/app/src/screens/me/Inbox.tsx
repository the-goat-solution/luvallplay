// The three latest conversations with the club; each opens in the inbox.
import { Link } from "@tanstack/react-router";
import type { Me } from "./data.ts";
import { usePlace } from "./parts.tsx";

export function InboxPreview({ inbox }: { inbox: Me["inbox"] }) {
  const { t } = usePlace();
  return (
    <section className="card stack" aria-labelledby="inbox-title">
      <h2 id="inbox-title">{t("me_inbox_preview")}</h2>
      {inbox.latest.length === 0 ? (
        <p className="muted">{t("me_inbox_none")}</p>
      ) : (
        <ul className="threads">
          {inbox.latest.map((th) => (
            <li key={th.id} className={th.unread ? "thread unread" : "thread"}>
              <Link className="thread-link" to="/inbox/$id" params={{ id: String(th.id) }}>
                <strong>
                  {th.unread && <span className="unread-dot" aria-hidden="true" />}
                  {th.subject}
                  {th.unread && <span className="visually-hidden"> ({t("msg_new_badge")})</span>}
                </strong>
                <span className="muted small thread-preview">{th.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/inbox" className="button">
        {t("me_inbox_open")}
      </Link>
    </section>
  );
}
