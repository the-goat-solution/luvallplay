// Home (the first tab): "What's next?" A greeting, the next play day, the
// calendar, messages from the club, its shop, and the way in for someone
// who isn't a member yet. Who the person is (picture, memberships, photos,
// settings) is My profile, their picture in the top bar.
//
// One club: that club's Home. Several: every club together (me/Home.tsx).
import { useClubs, useLang, useSession, useT } from "../hooks.tsx";
import { Icon } from "../components/Icon.tsx";
import { nextUp } from "../lib/format.ts";
import { useMe } from "./me/data.ts";
import { InboxPreview } from "./me/Inbox.tsx";
import { AllClubsHome } from "./me/Home.tsx";
import { JoinCard } from "./me/Membership.tsx";
import { MembershipAlert } from "./me/MembershipAlert.tsx";
import { NextUp } from "./me/NextUp.tsx";
import { usePlace } from "./me/parts.tsx";
import { PlayCalendar } from "./me/PlayCalendar.tsx";
import { WelcomeCard } from "./me/Welcome.tsx";
import { ShopSection } from "./shop/ShopSection.tsx";
import { LoadError } from "../components/LoadError.tsx";
import { Greeting } from "../components/Greeting.tsx";

export function HomeLoading() {
  const session = useSession();
  return (
    <div className="stack" aria-busy="true">
      <Greeting firstName={session.data?.player.firstName ?? ""} />
      <HomeSkeleton />
    </div>
  );
}

function HomeSkeleton() {
  const { t } = usePlace();
  return (
    <>
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
    </>
  );
}

export default function HomeScreen() {
  const clubs = useClubs().data?.clubs ?? null;
  if (clubs && clubs.length === 0) return <NoClub />;
  if (clubs && clubs.length > 1) return <AllClubsHome clubs={clubs} />;
  return <ClubHome />;
}

/** Signed in, but in no club yet (signed up without an invite): what this is, and the way to a club. */
function NoClub() {
  const session = useSession();
  const t = useT();
  const lang = useLang();
  return (
    <section className="screen stack" data-screen="nav_home" data-state="empty">
      <Greeting firstName={session.data?.player.firstName ?? ""} />
      <div className="card stack empty-state">
        <span className="empty-icon"><Icon name="rackets" size={28} /></span>
        <h2 className="title">{t("noclub_title")}</h2>
        <p className="muted">{t("noclub_body")}</p>
        <div>
          <a className="button button-primary" href={`https://luvallplay.com/${lang}/find-a-club`} target="_blank" rel="noopener noreferrer">
            {t("noclub_find")}
            <Icon name="external" size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}

function ClubHome() {
  const me = useMe();
  const session = useSession();
  if (!me.data) {
    return (
      <section className="screen stack" data-screen="nav_home" data-state={me.isError ? "error" : "loading"}>
        {me.isError ? <LoadError onRetry={() => void me.refetch()} /> : <HomeLoading />}
      </section>
    );
  }
  const data = me.data;
  return (
    <section className="screen stack" data-screen="nav_home" data-state="ready">
      <Greeting firstName={session.data?.player.firstName ?? data.player.firstName} />
      <MembershipAlert m={data.membership} />
      <div className="me-grid">
        <div className="stack">
          <NextUp day={nextUp(data.calendar)} />
          {!data.membership && data.join && <JoinCard join={data.join} />}
          <PlayCalendar days={data.calendar} casualPrice={data.casualPrice} />
        </div>
        <div className="stack">
          <InboxPreview inbox={data.inbox} />
          {data.welcome && <WelcomeCard firstName={data.player.firstName} />}
          <ShopSection />
        </div>
      </div>
    </section>
  );
}
