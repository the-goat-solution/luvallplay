// The latest conversations with the club. Reading and replying move into the
// app with the inbox step; until then a conversation opens on the club's
// website (?thread= opens it there, as message emails do).
import { forwardRef } from "react";
import type { Me } from "./data.ts";
import { usePlace, webHref, WebsiteLink } from "./parts.tsx";

export const InboxPreview = forwardRef<HTMLElement, { inbox: Me["inbox"] }>(function InboxPreview({ inbox }, ref) {
  const { t, webUrl } = usePlace();
  const all = webHref(webUrl, "/profile?inbox=1");
  return (
    <section className="card stack" id="inbox" aria-labelledby="inbox-title" ref={ref} tabIndex={-1}>
      <h2 id="inbox-title">{t("me_inbox_preview")}</h2>
      {inbox.latest.length === 0 ? (
        <p className="muted">{t("me_inbox_none")}</p>
      ) : (
        <ul className="threads">
          {inbox.latest.map((th) => {
            const href = webHref(webUrl, `/profile?thread=${th.id}`);
            const body = (
              <>
                <strong>
                  {th.unread && <span className="unread-dot" aria-hidden="true" />}
                  {th.subject}
                  {th.unread && <span className="visually-hidden"> ({t("me_inbox_unread", { n: 1 })})</span>}
                </strong>
                <span className="muted small thread-preview">{th.preview}</span>
              </>
            );
            return (
              <li key={th.id} className={th.unread ? "thread unread" : "thread"}>
                {href ? (
                  <a className="thread-link" href={href} target="_blank" rel="noopener noreferrer">
                    {body}
                  </a>
                ) : (
                  <div className="thread-link">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {all && <WebsiteLink href={all}>{t("me_inbox_open")}</WebsiteLink>}
    </section>
  );
});
