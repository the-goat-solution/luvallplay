import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "../globals.css";
import { siteOrigin } from "@/lib/site";
import { isLang, LANGS } from "@/lib/types";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  applicationName: "Luvallplay",
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf7" }, { media: "(prefers-color-scheme: dark)", color: "#0b1b2b" }],
};

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

// Applies the visitor's saved theme before first paint (no flash), and marks
// that JavaScript is running. Nothing else runs here.
const boot = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}document.documentElement.classList.remove("no-js")`;

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={lang} className="no-js" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
        <link rel="preload" href="/fonts/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/be-vietnam-pro-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        {children}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
