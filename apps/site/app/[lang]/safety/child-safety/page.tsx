import type { Metadata } from "next";
import { LegalPageView, render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { pageMeta } from "@/lib/meta";
import type { Lang } from "@/lib/types";

// The child-safety standards Google Play asks every social app to publish.
// The address is given to the stores, so it must not move.
const PATH = "/safety/child-safety";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  const doc = content.legal["child-safety"];
  return pageMeta(lang, PATH, `${doc.title[lang]} · Luvallplay`, doc.summary[lang], content);
}

export default async function Page({ params }: Props) {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  return render(lang, PATH, content, <LegalPageView lang={lang} content={content} slug="child-safety" />);
}
