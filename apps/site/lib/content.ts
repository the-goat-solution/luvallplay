// The site's content: Sanity when it's configured, the repo's seed otherwise
// (and for any document Sanity doesn't have yet). One cached query feeds
// every page; publishing in the Studio calls /api/revalidate, which clears it.
import { draftMode } from "next/headers";
import seed from "@/content/generated/seed.json" with { type: "json" };
import type { Club, Content, Doc, FaqItem, HelpArticle, LegalPage, Page, Sport, Testimonial, HomePage, SiteSettings } from "./types";

export const CONTENT_TAG = "content";

export function sanityConfig(env: Record<string, string | undefined> = process.env) {
  const projectId = env.SANITY_PROJECT_ID || env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  if (!projectId) return null;
  return { projectId, dataset: env.SANITY_DATASET || "production", token: env.SANITY_API_READ_TOKEN };
}

const QUERY = `*[_type in ["siteSettings","homePage","page","sport","club","faqItem","helpArticle","legalPage","testimonial"]]{
  ...,
  "logo": logo{"url": asset->url, alt},
  _type == "homePage" => { hero{..., photos[]{..., "image": image{"url": asset->url, alt}}} }
}`;

async function fetchSanity(preview: boolean): Promise<Doc[] | null> {
  const cfg = sanityConfig();
  if (!cfg) return null;
  const draft = preview && !!cfg.token;
  const host = draft ? "api.sanity.io" : "apicdn.sanity.io";
  const url = `https://${cfg.projectId}.${host}/v2025-02-19/data/query/${cfg.dataset}?query=${encodeURIComponent(QUERY)}&perspective=${draft ? "drafts" : "published"}`;
  try {
    const res = await fetch(url, {
      headers: draft || cfg.token ? { Authorization: `Bearer ${cfg.token}` } : undefined,
      ...(draft ? { cache: "no-store" as const } : { next: { tags: [CONTENT_TAG], revalidate: 3600 } }),
    });
    if (!res.ok) throw new Error(`Sanity ${res.status}`);
    const json = (await res.json()) as { result: Doc[] };
    return json.result;
  } catch (err) {
    console.error("[content] Sanity fetch failed, using the seed", err);
    return null;
  }
}

/** Seed first, then Sanity's documents over the top (matched by _id). */
export function assemble(seedDocs: Doc[], live: Doc[] | null): Content {
  const byId = new Map<string, Doc>();
  for (const d of seedDocs) byId.set(d._id, d);
  // A document unpublished in Sanity falls back to its seed; lists (clubs,
  // FAQ, help, sports) come wholly from Sanity once it has any of that type.
  const liveTypes = new Set((live ?? []).map((d) => d._type));
  const listTypes = new Set(["club", "faqItem", "helpArticle", "sport", "testimonial"]);
  for (const [id, d] of byId) if (listTypes.has(d._type) && liveTypes.has(d._type)) byId.delete(id);
  for (const d of live ?? []) byId.set(d._id.replace(/^drafts\./, ""), { ...(byId.get(d._id) ?? {}), ...d } as Doc);
  const all = [...byId.values()];
  const of = <T extends Doc>(type: T["_type"]) => all.filter((d): d is T => d._type === type);
  const order = <T extends { order: number }>(xs: T[]) => xs.sort((a, b) => a.order - b.order);
  return {
    settings: of<SiteSettings>("siteSettings")[0],
    home: of<HomePage>("homePage")[0],
    pages: Object.fromEntries(of<Page>("page").map((p) => [p.key, p])),
    sports: order(of<Sport>("sport")),
    clubs: of<Club>("club").sort((a, b) => a.name.localeCompare(b.name)),
    faq: order(of<FaqItem>("faqItem")),
    help: order(of<HelpArticle>("helpArticle")),
    legal: Object.fromEntries(of<LegalPage>("legalPage").map((p) => [p.slug, p])),
    testimonials: of<Testimonial>("testimonial").filter((t) => t.consent === true),
  };
}

export async function getContent(): Promise<Content> {
  // Draft preview only exists when Sanity and a read token are configured.
  let preview = false;
  if (sanityConfig()?.token) {
    try {
      preview = (await draftMode()).isEnabled;
    } catch {
      // Outside a request (build scripts, tests).
    }
  }
  return assemble(seed as unknown as Doc[], await fetchSanity(preview));
}

/** The seed alone: used by tests and the completeness check. */
export function seedContent(): Content {
  return assemble(seed as unknown as Doc[], null);
}
