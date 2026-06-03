import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Three Wolves Badminton Club — Christchurch, NZ",
  description:
    "Three Wolves Badminton Club — Weekly Friday sessions at Graham Condon Recreation Centre, Christchurch. All skill levels welcome.",
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
