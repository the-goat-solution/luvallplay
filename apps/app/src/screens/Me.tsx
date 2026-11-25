// Me (the home tab): "What's my status, and what's next?", as the website's
// Me page (apps/web/app/profile/page.tsx). Two columns when the screen is
// wide enough: next up, membership and the calendar; the inbox and the
// welcome card beside them. Cards for modules the club has off aren't there.
//
// The shop and My photos (with the Gallery on) sit in the second column.
// The inbox is its own screen (/inbox), opened from the bell and the
// Messages card.
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
import { ShopSection } from "./shop/ShopSection.tsx";
import { PhotosCard } from "./me/Photos.tsx";
import { LoadError } from "../components/LoadError.tsx";

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
  const session = useSession();

  if (!me.data) {
    return (
      <section className="screen stack" data-screen="nav_me" data-state={me.isError ? "error" : "loading"}>
        {me.isError ? (
          <LoadError onRetry={() => void me.refetch()} />
        ) : (
          <Loading />
        )}
      </section>
    );
  }

  const data = me.data;

  return (
    <section className="screen stack" data-screen="nav_me" data-state="ready">
      <MeHeader me={data} />
      <div className="me-grid">
        <div className="stack">
          <NextUp day={nextUp(data.calendar)} />
          {data.membership ? <MembershipCard m={data.membership} /> : data.join ? <JoinCard join={data.join} /> : null}
          <PlayCalendar days={data.calendar} casualPrice={data.casualPrice} />
        </div>
        <div className="stack">
          <InboxPreview inbox={data.inbox} />
          {data.welcome && <WelcomeCard firstName={data.player.firstName} />}
          <ShopSection />
          {session.data && <PhotosCard t={t} playerId={session.data.player.id} />}
        </div>
      </div>
    </section>
  );
}
