import type { Viewport } from "next";
import adminStyles from "@/components/admin/admin.module.css";
import { DeviceCheck } from "@/components/admin/DeviceCheck";

// Same viewport settings as the profile app, so the numbers match it.
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#0e2c3f" };

export default function DeviceCheckPage() {
  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Screen check</h1>
      <p className={adminStyles.subtitle}>
        Open this page on a phone, tablet or foldable (or in Xcode&apos;s iPhone Duo simulator) to see exactly what the website gets: width and height,
        safe areas, whether a fold is reported, and whether it&apos;s running as a home-screen app. Fold, unfold and rotate: it updates live. Take a
        screenshot of each pose for the layout tests.
      </p>
      <DeviceCheck />
    </div>
  );
}
