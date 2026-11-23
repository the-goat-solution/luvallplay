import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "./providers";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Script src="https://js.stripe.com/v3/" strategy="lazyOnload" />
      </body>
    </html>
  );
}
