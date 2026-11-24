import type { Metadata } from "next";
import { FormPage, render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { pageMeta } from "@/lib/meta";
import type { Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string }> };
const KEY = "get-the-app";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  const page = content.pages[KEY];
  return pageMeta(lang, `/${KEY}`, page.seoTitle[lang], page.seoDescription[lang], content);
}

export default async function Page({ params }: Props) {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  return render(lang, `/${KEY}`, content, <FormPage lang={lang} content={content} pageKey={KEY} kind="app" />);
}
