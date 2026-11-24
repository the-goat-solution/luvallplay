// A club's invite or QR link (/c/<club>): the club's look first, then
// sign-in. Someone already signed in goes straight to that club.
import { useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { store } from "../app.ts";
import { Notice, Splash } from "../Frame.tsx";
import { useClubConfig, usePrefs, useT } from "../hooks.tsx";
import { SignInForm, SignedOutPage } from "./SignIn.tsx";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function InviteScreen() {
  const { club: raw } = useParams({ from: "/c/$club" });
  const slug = SLUG.test(raw) ? raw : null;
  const { token } = usePrefs();
  const navigate = useNavigate();
  const config = useClubConfig(slug);
  const t = useT(config.data);

  useEffect(() => {
    if (token && slug) {
      store.set({ club: slug });
      void navigate({ to: "/me", replace: true });
    }
  }, [token, slug, navigate]);

  if (token) return <Splash />;
  if (slug && config.isPending) return <Splash />;
  const club = config.data ?? null;
  return (
    <SignedOutPage club={club}>
      {club ? (
        <div className="stack">
          <p className="lead">{t("invite_joining", { club: club.club.name })}</p>
          <p className="muted">{t("invite_lead", { club: club.club.name })}</p>
        </div>
      ) : (
        <Notice>{t("invite_not_found")}</Notice>
      )}
      <SignInForm club={club?.club.slug} />
    </SignedOutPage>
  );
}
