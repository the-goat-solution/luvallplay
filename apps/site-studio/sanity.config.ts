import { defineConfig } from "sanity";
import { structureTool, type StructureBuilder } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { dataset, projectId } from "./project";
import { schemaTypes, SINGLETONS } from "./schema";

// Luvallplay's website content: every section of the home page, the inner
// pages, help centre, FAQ, legal pages, the curated club list and sports.
// Each text field has an English and a Vietnamese box, side by side.
const structure = (S: StructureBuilder) =>
  S.list()
    .title("Luvallplay website")
    .items([
      S.listItem().title("Site settings (launch mode, links, company)").id("siteSettings").child(S.document().schemaType("siteSettings").documentId("siteSettings")),
      S.listItem().title("Home page").id("homePage").child(S.document().schemaType("homePage").documentId("homePage")),
      S.divider(),
      S.documentTypeListItem("page").title("Pages"),
      S.documentTypeListItem("helpArticle").title("Help articles"),
      S.documentTypeListItem("faqItem").title("FAQ"),
      S.documentTypeListItem("legalPage").title("Legal pages"),
      S.divider(),
      S.documentTypeListItem("club").title("Clubs (Find a club)"),
      S.documentTypeListItem("sport").title("Sports"),
      S.documentTypeListItem("testimonial").title("Quotes (need consent)"),
    ]);

export default defineConfig({
  name: "luvallplay-site",
  title: "Luvallplay website",
  projectId,
  dataset,
  plugins: [structureTool({ structure }), visionTool()],
  schema: {
    types: schemaTypes,
    // One settings document and one home page: no "create new" for them.
    templates: (templates) => templates.filter((t) => !SINGLETONS.includes(t.schemaType)),
  },
  document: {
    actions: (actions, { schemaType }) => (SINGLETONS.includes(schemaType) ? actions.filter((a) => a.action !== "duplicate" && a.action !== "delete" && a.action !== "unpublish") : actions),
  },
});
