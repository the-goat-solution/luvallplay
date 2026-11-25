// The welcome card for a new account, until they press Done.
import { useDismissWelcome } from "./data.ts";
import { usePlace } from "./parts.tsx";

export function WelcomeCard({ firstName }: { firstName: string }) {
  const { t } = usePlace();
  const dismiss = useDismissWelcome();
  return (
    <section className="card stack welcome" aria-labelledby="welcome-title">
      <h2 className="title" id="welcome-title">{t("welcome_title", { name: firstName || "👋" })}</h2>
      <p>{t("welcome_body")}</p>
      <ol>
        <li>{t("welcome_check_name")}</li>
        <li>{t("welcome_confirm_phone")}</li>
        <li>{t("welcome_leaderboard")}</li>
      </ol>
      <div>
        <button type="button" className="button button-on-primary" onClick={() => dismiss.mutate()}>
          {t("welcome_dismiss")}
        </button>
      </div>
    </section>
  );
}
