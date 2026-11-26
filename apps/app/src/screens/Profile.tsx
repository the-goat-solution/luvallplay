// My profile: who the person is, everything that is theirs, in one place.
// Opened from their picture in the top bar (as most apps do).
// - The header: picture, name, email.
// - Memberships: each club's (or the way in), with Manage.
// - My photos, for the clubs that share them.
// - Settings (screens/Settings.tsx): picture and details, privacy, language,
//   appearance, connected apps, install, Club admin, signing out.
// With several clubs it is Luvallplay's, like Home, each card tagged with
// its club; with one, the club's.
import { useEffect, useId } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiForClub } from "../app.ts";
import { ClubScopeProvider, useClubConfigs, useClubs, useCurrentClub, useSession, useT, type Club, useWho } from "../hooks.tsx";
import { meKey, type Me } from "./me/data.ts";
import { JoinCard, MembershipCard } from "./me/Membership.tsx";
import { PhotosCard } from "./me/Photos.tsx";
import { SettingsSections } from "./Settings.tsx";
import { usePlace } from "./me/parts.tsx";
import { dayLabel } from "../lib/format.ts";
import { LoadError } from "../components/LoadError.tsx";
import { FamilyEntry } from "./family/Entry.tsx";

type MeQuery = { data?: Me; isError: boolean; refetch: () => unknown };

/** The membership in one word or two: "Active · renews 18 Dec" with one club, "Member at 1 of 2 clubs" with several. */
function usePill(clubs: Club[], results: MeQuery[], multi: boolean): { text: string; active: boolean } | null {
  const { config } = useCurrentClub();
  const t = useT(multi ? null : config);
  const { locale } = usePlace();
  const loaded = results.filter((r) => r.data);
  if (loaded.length === 0) return null;
  if (multi) {
    const members = loaded.filter((r) => r.data?.membership).length;
    return members > 0 ? { text: t("home_pill_member", { n: members, total: clubs.length }), active: true } : { text: t("home_pill_clubs", { n: clubs.length }), active: false };
  }
  const m = loaded[0].data?.membership;
  if (!m) return { text: t("me_pill_none"), active: false };
  if (m.autoRenews && m.periodEnd) return { text: t("me_pill_renews", { date: dayLabel(m.periodEnd, locale) }), active: true };
  // A paid follow-on membership carries them on: the pill shows when that one ends (as on the website).
  const end = m.next?.periodEnd ?? m.periodEnd;
  return end ? { text: t("me_pill_ends", { date: dayLabel(end, locale) }), active: true } : { text: t("me_pill_active"), active: true };
}

function Head({ pill }: { pill: { text: string; active: boolean } | null }) {
  const session = useSession();
  const p = session.data?.player;
  const name = p ? `${p.firstName} ${p.lastName}`.trim() || p.displayName : "";
  const initials = p ? `${p.firstName.trim()[0] ?? ""}${p.lastName.trim()[0] ?? ""}`.toUpperCase() : "";
  const t = useT();
  return (
    <header className="profile-head">
      <div className="avatar avatar-large" aria-hidden="true">
        {p?.avatarUrl ? <img src={p.avatarUrl} alt="" width={96} height={96} /> : initials}
      </div>
      <div className="profile-who">
        <h1>{name || t("nav_profile")}</h1>
        {p && <p className="muted">{p.email}</p>}
        {pill && <span className={`pill${pill.active ? " pill-active" : ""}`}>{pill.text}</span>}
      </div>
    </header>
  );
}

function useMeAll(clubs: Club[]): MeQuery[] {
  const who = useWho();
  return useQueries({
    queries: clubs.map((c) => ({
      queryKey: meKey(c.slug, who),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiForClub(c.apiBase).me.home({ club: c.slug }, { signal }),
      enabled: !!who,
      staleTime: 30_000,
    })),
  });
}

function Memberships({ clubs, multi, results }: { clubs: Club[]; multi: boolean; results: MeQuery[] }) {
  const session = useSession();
  const { config } = useCurrentClub();
  const t = useT(multi ? null : config);
  const configs = useClubConfigs(clubs);
  const id = useId();
  const cards = clubs.flatMap((club, i) => {
    const me = results[i].data as Me | undefined;
    if (!me) return results[i].isError ? [{ club, node: <LoadError compact onRetry={() => void results[i].refetch()} /> }] : [];
    const node = me.membership ? <MembershipCard m={me.membership} /> : me.join ? <JoinCard join={me.join} /> : null;
    return node ? [{ club, node }] : [];
  });
  const photos = session.data
    ? clubs.filter((_, i) => configs[i]?.modules.includes("gallery"))
    : [];
  if (cards.length === 0 && photos.length === 0) return null;
  return (
    <section className="stack profile-section" aria-labelledby={id}>
      <h2 className="section-title" id={id}>{t("profile_memberships")}</h2>
      <div className="panes">
        {cards.map(({ club, node }) => (
          <ClubScopeProvider key={club.slug} club={club}>
            {node}
          </ClubScopeProvider>
        ))}
        {session.data &&
          photos.map((club) => (
            <ClubScopeProvider key={`photos:${club.slug}`} club={club}>
              <PhotosCard t={t} playerId={session.data!.player.id} onlyWhenOn={multi} />
            </ClubScopeProvider>
          ))}
      </div>
    </section>
  );
}

export default function ProfileScreen() {
  const clubs = useClubs().data?.clubs ?? [];
  const multi = clubs.length > 1;
  const results = useMeAll(clubs);
  const pill = usePill(clubs, results, multi);
  // /settings lands here: open at the settings.
  useEffect(() => {
    if (window.location.hash === "#settings") document.getElementById("settings")?.scrollIntoView();
  }, []);
  return (
    <section className="screen stack profile" data-screen="nav_profile">
      <Head pill={pill} />
      <Memberships clubs={clubs} multi={multi} results={results} />
      {/* One row per club that has Juniors on; nothing otherwise (screens/family). */}
      {clubs.map((club) => (
        <ClubScopeProvider key={`family:${club.slug}`} club={club}>
          <FamilyEntry />
        </ClubScopeProvider>
      ))}
      <SettingsSections />
    </section>
  );
}
