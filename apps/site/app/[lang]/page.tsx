import type { Metadata } from "next";
import { Features, FinderSection, ForClubs, Hero, How, Pricing, Vision } from "@/components/Home";
import { render } from "@/components/Pages";
import { getContent } from "@/lib/content";
import { jsonLd, pageMeta } from "@/lib/meta";
import { originFor } from "@/lib/site";
import type { Lang } from "@/lib/types";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  return pageMeta(lang, "", content.home.seoTitle[lang], content.home.seoDescription[lang], content);
}

export default async function HomePage({ params }: Props) {
  const lang = (await params).lang as Lang;
  const content = await getContent();
  const origin = originFor(lang);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Luvallplay",
      url: origin,
      logo: `${origin}/brand/luvallplay-mark.svg`,
      slogan: "Love all, play.",
      parentOrganization: { "@type": "Organization", name: content.settings.companyName },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Luvallplay",
      applicationCategory: "SportsApplication",
      operatingSystem: "Web",
      description: content.home.seoDescription[lang],
      inLanguage: ["en", "vi"],
      offers: { "@type": "Offer", price: "0", priceCurrency: "NZD", description: content.home.pricing.players.body[lang] },
    },
  ];
  const p = { lang, content };
  return render(lang, "", content, (
    <>
      <Hero {...p} />
      <Features {...p} />
      <Vision {...p} />
      <How {...p} />
      <FinderSection {...p} />
      <ForClubs {...p} />
      <Pricing {...p} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(ld)} />
    </>
  ));
}
