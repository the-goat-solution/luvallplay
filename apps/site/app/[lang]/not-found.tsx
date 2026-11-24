import type { Metadata } from "next";
import { NotFoundBody } from "@/components/NotFoundBody";
import { Shell } from "@/components/Shell";
import { getContent } from "@/lib/content";
import { LANGS } from "@/lib/types";

export const metadata: Metadata = { title: "404 · Luvallplay", robots: { index: false, follow: false } };

// A not-found page is given no params, and reading the request would stop the
// whole site being pre-rendered. So both languages are rendered and CSS shows
// the one that matches <html lang> (set by the layout from the URL).
export default async function NotFound() {
  const content = await getContent();
  return LANGS.map((lang) => (
    <div key={lang} className={`only-${lang}`}>
      <Shell lang={lang} path="" content={content} mainId={`main-${lang}`}>
        <NotFoundBody lang={lang} />
      </Shell>
    </div>
  ));
}
