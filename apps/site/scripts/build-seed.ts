// Builds content/generated/seed.json: every seeded document in the shape
// Sanity stores. Run before dev, build, typecheck and test (see package.json).
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { markdownToBlocks, parseFrontmatter } from "../lib/markdown.ts";
import { clubs, home, pages, settings, sports } from "../content/site-content.ts";
import type { Doc, FaqItem, HelpArticle, LegalPage } from "../lib/types.ts";

const root = path.join(import.meta.dirname, "..", "content");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");

const help: HelpArticle[] = [];
const helpDir = path.join(root, "help");
if (existsSync(helpDir)) {
  const slugs = [...new Set(readdirSync(helpDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.(en|vi)\.md$/, "")))].sort();
  for (const slug of slugs) {
    if (!existsSync(path.join(helpDir, `${slug}.en.md`)) || !existsSync(path.join(helpDir, `${slug}.vi.md`))) {
      throw new Error(`Help article "${slug}" must exist in both languages`);
    }
    const en = parseFrontmatter(read("help", `${slug}.en.md`));
    const vi = parseFrontmatter(read("help", `${slug}.vi.md`));
    help.push({
      _id: `help.${slug}`,
      _type: "helpArticle",
      slug,
      title: { en: en.data.title, vi: vi.data.title },
      summary: { en: en.data.summary, vi: vi.data.summary },
      audience: en.data.audience as HelpArticle["audience"],
      order: Number(en.data.order),
      updated: en.data.updated,
      body: { en: markdownToBlocks(en.body), vi: markdownToBlocks(vi.body) },
    });
  }
  help.sort((a, b) => a.order - b.order);
}

const legal: LegalPage[] = [];
for (const slug of ["privacy", "terms"] as const) {
  if (!existsSync(path.join(root, "legal", `${slug}.en.md`))) continue;
  const en = parseFrontmatter(read("legal", `${slug}.en.md`));
  const vi = parseFrontmatter(read("legal", `${slug}.vi.md`));
  legal.push({
    _id: `legal.${slug}`,
    _type: "legalPage",
    slug,
    title: { en: en.data.title, vi: vi.data.title },
    summary: { en: en.data.summary, vi: vi.data.summary },
    updated: en.data.updated,
    body: { en: markdownToBlocks(en.body), vi: markdownToBlocks(vi.body) },
  });
}

let faq: FaqItem[] = [];
if (existsSync(path.join(root, "faq.json"))) {
  const raw = JSON.parse(read("faq.json")) as { id: string; topic: FaqItem["topic"]; q: FaqItem["q"]; a: FaqItem["a"] }[];
  faq = raw.map((f, i) => ({ _id: `faq.${f.id}`, _type: "faqItem", topic: f.topic, order: i + 1, q: f.q, a: f.a }));
}

const docs: Doc[] = [settings, home, ...pages, ...sports, ...clubs, ...faq, ...help, ...legal];
mkdirSync(path.join(root, "generated"), { recursive: true });
writeFileSync(path.join(root, "generated", "seed.json"), JSON.stringify(docs, null, 1));
console.log(`seed: ${docs.length} documents (${help.length} help articles, ${legal.length} legal pages, ${faq.length} FAQ items)`);
