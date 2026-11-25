// Me (the home tab): "What's my status, and what's next?", as the website's
// Me page (apps/web/app/profile/page.tsx). Two columns when the screen is
// wide enough: next up, membership and the calendar; the inbox and the
// welcome card beside them. Cards for modules the club has off aren't there.
//
// Not here yet (later steps): the shop and My photos (with the shop and
// Player steps), and paying in the app (the membership step).
import { useRef } from "react";
import { useSession } from "../hooks.tsx";
import { nextUp } from "../lib/format.ts";
import { useMe } from "./me/data.ts";
import { InboxPreview } from "./me/Inbox.tsx";
import { MeHeader } from "./me/MeHeader.tsx";
import { JoinCard, MembershipCard } from "./me/Membership.tsx";
import { NextUp } from "./me/NextUp.tsx";
import { usePlace } from "./me/parts.tsx";
import { PlayCalendar } from "./me/PlayCalendar.tsx";
import { WelcomeCard } from "./me/Welcome.tsx";

function Loading() {
  const { t } = usePlace();
  const session = useSession();
  const name = session.data ? `${session.data.player.firstName} ${session.data.player.lastName}`.trim() : "";
  return (
    <div className="stack" aria-busy="true">
      <header className="me-head">
        <div className="avatar skeleton" aria-hidden="true" />
        <div className="me-who">
          <h1>{name || t("nav_me")}</h1>
        </div>
      </header>
      <p className="visually-hidden" role="status">{t("loading")}</p>
      <div className="me-grid" aria-hidden="true">
        <div className="stack">
          <div className="card skeleton skeleton-short" />
          <div className="card skeleton skeleton-tall" />
        </div>
        <div className="stack">
          <div className="card skeleton skeleton-short" />
        </div>
      </div>
    </div>
  );
}

export default function MeScreen() {
  const { t } = usePlace();
  const me = useMe();
  const inboxRef = useRef<HTMLElement>(null);

  if (!me.data) {
    return (
      <section className="screen stack" data-screen="nav_me" data-state={me.isError ? "error" : "loading"}>
        {me.isError ? (
          <div className="card stack" role="alert">
            <p>{t("me_retry_load")}</p>
            <div>
              <button type="button" className="button" onClick={() => void me.refetch()}>
                {t("retry")}
              </button>
            </div>
          </div>
        ) : (
          <Loading />
        )}
      </section>
    );
  }

  const data = me.data;
  const openInbox = () => {
    const el = inboxRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  return (
    <section className="screen stack" data-screen="nav_me" data-state="ready">
      <MeHeader me={data} onOpenInbox={openInbox} />
      <div className="me-grid">
        <div className="stack">
          <NextUp day={nextUp(data.calendar)} />
          {data.membership ? <MembershipCard m={data.membership} /> : data.join ? <JoinCard join={data.join} /> : null}
          <PlayCalendar days={data.calendar} casualPrice={data.casualPrice} />
        </div>
        <div className="stack">
          <InboxPreview inbox={data.inbox} ref={inboxRef} />
          {data.welcome && <WelcomeCard firstName={data.player.firstName} />}
        </div>
      </div>
    </section>
  );
}
