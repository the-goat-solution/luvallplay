import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer, safeNextPath } from "@/lib/player-auth";
import { DetailsForm } from "@/components/profile/DetailsForm";
import styles from "@/components/profile/profile.module.css";

export const metadata: Metadata = { title: "Welcome — Three Wolves", robots: { index: false } };
export const viewport: Viewport = { themeColor: "#0e2c3f", viewportFit: "cover" };
export const dynamic = "force-dynamic";

// First sign-in for a brand-new account: just a name (phone optional).
export default async function DetailsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  const player = await getCurrentPlayer();
  if (!player) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (player.firstName.trim()) redirect(next);
  return (
    <main className={styles.authPage}>
      <Link href="/" className={styles.authBrand}>
        <img src="/icons/wolf-mark-light.png" alt="" width={96} height={52} />
        <span>Three Wolves</span>
      </Link>
      <div className={styles.authCard}>
        <DetailsForm next={next} email={player.email} phone={player.phone ?? ""} lang={player.lang} />
      </div>
    </main>
  );
}
