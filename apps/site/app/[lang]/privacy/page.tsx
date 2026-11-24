import type { Metadata } from "next";
import { LegalPageView, render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { pageMeta } from "@/lib/meta";
import type { Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  const doc = content.legal["privacy"];
  return pageMeta(lang, "/privacy", `${doc.title[lang]} · Luvallplay`, doc.summary[lang], content);
}

export default async function Page({ params }: Props) {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  return render(lang, "/privacy", content, <LegalPageView lang={lang} content={content} slug="privacy" />);
}
