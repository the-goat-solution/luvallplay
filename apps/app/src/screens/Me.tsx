// Me: a placeholder until the real screen moves in (step 3). It already
// shows who is signed in and which club they are looking at.
import { useCurrentClub, useSession, useT } from "../hooks.tsx";

export default function MeScreen() {
  const { config, current } = useCurrentClub();
  const session = useSession();
  const t = useT(config);
  const name = session.data?.player.firstName || session.data?.player.displayName || "";
  return (
    <section className="screen stack" data-screen="nav_me">
      <h1>{name ? t("me_hello", { name }) : t("nav_me")}</h1>
      {current && (
        <div className="card stack">
          <p className="muted">{t("me_club")}</p>
          <p className="lead">{current.name}</p>
        </div>
      )}
      <div className="card stack">
        <h2>{t("coming_title")}</h2>
        <p className="muted">{t("coming_body")}</p>
      </div>
    </section>
  );
}
