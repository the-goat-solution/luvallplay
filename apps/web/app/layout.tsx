import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import { clubConfig } from "@/lib/club";
import { publicClub } from "@/lib/club-public";
import "./globals.css";

export const metadata: Metadata = {
  title: "Three Wolves Badminton Club — Christchurch, NZ",
  description:
    "Three Wolves Badminton Club — Badminton sessions in Christchurch. All skill levels welcome.",
  // Home-screen app on iPhone/iPad (the manifest covers Android).
  appleWebApp: {
    capable: true,
    title: "3 Wolves",
    statusBarStyle: "black-translucent",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The club's public settings, for client components (useClub()). Never
  // throws: the built-in values answer when the database can't.
  const club = publicClub(await clubConfig());
  return (
    <html lang="en">
      <body>
        <Providers club={club}>{children}</Providers>
        <Script src="https://js.stripe.com/v3/" strategy="lazyOnload" />
      </body>
    </html>
  );
}
