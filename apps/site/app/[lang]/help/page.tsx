import type { Metadata } from "next";
import { HelpIndex, render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { pageMeta } from "@/lib/meta";
import type { Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  const page = content.pages.help;
  return pageMeta(lang, "/help", page.seoTitle[lang], page.seoDescription[lang], content);
}

export default async function Page({ params }: Props) {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  return render(lang, "/help", content, <HelpIndex lang={lang} content={content} />);
}
