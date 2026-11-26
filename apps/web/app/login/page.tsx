import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer, safeNextPath } from "@/lib/player-auth";
import { getRecaptchaSiteKey, isSmsAvailable } from "@/lib/sms";
import { LoginForm } from "@/components/profile/LoginForm";
import { LangSync, LangToggle } from "@/components/profile/LangToggle";
import styles from "@/components/profile/profile.module.css";

export const metadata: Metadata = {
  title: "Sign in — Three Wolves Badminton Club",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0e2c3f",
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string; expired?: string; signed_out?: string; stepup?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const dbReady = Boolean(process.env.POSTGRES_URL);
  // Step-up (admin): already signed in, but admin needs a sign-in within the
  // last 12 hours. Show the form with their email filled in instead of
  // bouncing straight back.
  // stepup=action: a sensitive admin action needs a code entered in the last
  // five minutes (lib/admin-step-up.ts); same form, its own wording.
  const stepUpAction = params.stepup === "action";
  const stepUp = params.stepup === "1" || stepUpAction;
  const current = dbReady ? await getCurrentPlayer() : null;
  if (current && !stepUp) redirect(next);

  // Rendered with the right options already in place, so "Text me a code"
  // never flashes up and then disappears when the free texts are used up.
  const [smsAvailable, siteKey] = dbReady
    ? await Promise.all([isSmsAvailable(), getRecaptchaSiteKey().catch(() => null)])
    : [false, null];

  return (
    <main className={styles.authPage}>
      <LangSync />
      <Link href="/" className={styles.authBrand}>
        <img src="/icons/wolf-mark-light.png" alt="" width={96} height={52} />
        <span>Three Wolves</span>
      </Link>
      <div className={styles.authCard}>
        <LoginForm
          smsAvailable={smsAvailable}
          recaptchaSiteKey={siteKey}
          next={next}
          defaultEmail={params.email ?? (stepUp ? current?.email : "") ?? ""}
          notice={stepUpAction ? "stepup_action" : stepUp ? "stepup" : params.expired ? "expired" : params.signed_out ? "signed_out" : null}
        />
      </div>
      <div className={styles.authFoot}>
        <LangToggle dark />
        <Link href="/">← Three Wolves Badminton Club</Link>
      </div>
    </main>
  );
}
