import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/player-auth";
import { getProfileBadges } from "@/lib/profile-badges";
import { liveMatchFor } from "@/lib/arena-db";
import { ProfileShell } from "@/components/profile/ProfileShell";

export const metadata: Metadata = {
  title: "My Three Wolves",
  robots: { index: false },
};

// viewport-fit=cover lets the app use the whole screen (notch, Dynamic
// Island, home indicator); every edge pads itself with the safe-area insets.
export const viewport: Viewport = {
  themeColor: "#0e2c3f",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const dynamic = "force-dynamic";

export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const player = await getCurrentPlayer();
  if (!player) redirect("/login?next=/profile");
  const [badges, liveMatchId] = await Promise.all([getProfileBadges(player.id), liveMatchFor(player.id).catch(() => null)]);
  return (
    <ProfileShell
      player={{ firstName: player.firstName, lastName: player.lastName, email: player.email, lang: player.lang }}
      showInstallGuide={!player.installHintShown && !player.installedAt}
      badges={badges}
      liveMatchId={liveMatchId}
    >
      {children}
    </ProfileShell>
  );
}
