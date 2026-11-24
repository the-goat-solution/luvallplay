import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpArticlePage, render } from "@/components/Pages";
import { getContent, seedContent } from "@/lib/content";
import { pageMeta } from "@/lib/meta";
import { LANGS, type Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string; slug: string }> };

export const dynamicParams = true;
// Seeded articles are built ahead; ones added in the Studio render on first visit.
export function generateStaticParams() {
  return LANGS.flatMap((lang) => seedContent().help.map((h) => ({ lang, slug: h.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = (await params) as { lang: Lang; slug: string };
  const content = await getContent();
  const a = content.help.find((h) => h.slug === slug);
  if (!a) return {};
  return pageMeta(lang, `/help/${slug}`, `${a.title[lang]} · Luvallplay`, a.summary[lang], content);
}

export default async function Page({ params }: Props) {
  const { lang, slug } = (await params) as { lang: Lang; slug: string };
  const content = await getContent();
  if (!content.help.some((h) => h.slug === slug)) notFound();
  return render(lang, `/help/${slug}`, content, <HelpArticlePage lang={lang} content={content} slug={slug} />);
}
