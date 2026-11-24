// The website's content model. It mirrors apps/site/lib/types.ts: the site
// falls back to its seeded content for anything missing here.
import { defineArrayMember, defineField, defineType, type FieldDefinition } from "sanity";

export const SINGLETONS = ["siteSettings", "homePage"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const both = (rule: any) => rule.required();

// --- English and Vietnamese, side by side -----------------------------------
const locale = (name: string, title: string, inner: "string" | "text") =>
  defineType({
    name,
    title,
    type: "object",
    options: { columns: 2 },
    fields: [
      defineField({ name: "en", title: "English", type: inner, ...(inner === "text" ? { rows: 4 } : {}), validation: both }),
      defineField({ name: "vi", title: "Tiếng Việt", type: inner, ...(inner === "text" ? { rows: 4 } : {}), validation: both }),
    ],
  });

const richText = defineType({
  name: "richText",
  title: "Text",
  type: "array",
  of: [
    defineArrayMember({
      type: "block",
      styles: [{ title: "Paragraph", value: "normal" }, { title: "Heading", value: "h2" }, { title: "Small heading", value: "h3" }],
      lists: [{ title: "Bullets", value: "bullet" }, { title: "Numbered", value: "number" }],
      marks: {
        decorators: [{ title: "Bold", value: "strong" }],
        annotations: [
          {
            name: "link",
            type: "object",
            title: "Link",
            fields: [
              {
                name: "href",
                type: "string",
                title: "Address",
                description: "A page on this site without the language, like /help/what-is-luvallplay or /contact, or a full https:// address.",
                validation: both,
              },
            ],
          },
        ],
      },
    }),
  ],
});

const localeBlocks = defineType({
  name: "localeBlocks",
  title: "Text in both languages",
  type: "object",
  fields: [
    defineField({ name: "en", title: "English", type: "richText", validation: both }),
    defineField({ name: "vi", title: "Tiếng Việt", type: "richText", validation: both }),
  ],
});

const imageSlot = defineType({
  name: "imageSlot",
  title: "Photo",
  type: "image",
  description: "Real photos only, with the consent of the people in them. Leave empty to show the illustration.",
  options: { hotspot: true },
  fields: [defineField({ name: "alt", title: "Describe the photo (for people who can't see it)", type: "localeString" })],
  validation: (rule) =>
    rule.custom((value: { asset?: unknown; alt?: { en?: string; vi?: string } } | undefined) =>
      value?.asset && !(value.alt?.en && value.alt?.vi) ? "A photo needs its description in both languages" : true,
    ),
});

const s = (name: string, title: string, description?: string): FieldDefinition => defineField({ name, title, type: "localeString", description, validation: both });
const t = (name: string, title: string, description?: string): FieldDefinition => defineField({ name, title, type: "localeText", description, validation: both });
const group = (name: string, title: string, fields: FieldDefinition[]): FieldDefinition =>
  defineField({ name, title, type: "object", options: { collapsible: true, collapsed: true }, fields });
const list = (name: string, title: string, fields: FieldDefinition[], previewField = "title.en"): FieldDefinition =>
  defineField({ name, title, type: "array", of: [defineArrayMember({ type: "object", fields, preview: { select: { title: previewField } } })] });

const siteSettings = defineType({
  name: "siteSettings",
  title: "Site settings",
  type: "document",
  fields: [
    defineField({
      name: "launchMode",
      title: "Launch mode",
      description: "Coming soon: “Start your club”, “Get the app” and the store badges lead to the waitlist. Live: they lead to the setup wizard and the stores (fill in the links below first). Takes effect about a minute after publishing.",
      type: "string",
      options: { list: [{ title: "Coming soon", value: "coming-soon" }, { title: "Live", value: "live" }], layout: "radio" },
      initialValue: "coming-soon",
      validation: both,
    }),
    defineField({
      name: "searchIndexing",
      title: "Let search engines index the site",
      description: "Off until go-live: the site tells search engines to stay away. Switch on only when the site is on its real domain and ready to be found.",
      type: "boolean",
      initialValue: false,
    }),
    defineField({ name: "wizardUrl", title: "Setup wizard link (“Start your club” when live)", type: "url" }),
    defineField({ name: "appStoreUrl", title: "App Store link", type: "url" }),
    defineField({ name: "playStoreUrl", title: "Google Play link", type: "url" }),
    defineField({ name: "bookingUrl", title: "Scheduling link for “Book a walkthrough”", description: "Empty: the walkthrough request form is used.", type: "url" }),
    defineField({ name: "contactEmail", title: "Public contact email", description: "Shown on the contact, privacy and terms pages.", type: "string", validation: (rule) => rule.email() }),
    defineField({ name: "companyName", title: "Company name (as on Privacy and Terms)", type: "string", validation: both }),
    defineField({ name: "companyAddress", title: "Company postal address", type: "string" }),
  ],
  preview: { prepare: () => ({ title: "Site settings" }) },
});

const titled = [s("title", "Title"), t("body", "Text")];

const homePage = defineType({
  name: "homePage",
  title: "Home page",
  type: "document",
  fields: [
    s("seoTitle", "Title for search engines and browser tabs"),
    t("seoDescription", "Description for search engines"),
    group("ticker", "Header ticker", [
      s("label", "Label"),
      s("linkLabel", "Link label"),
      list("items", "Items (true statements only)", [s("strong", "Bold part"), s("rest", "Rest")], "strong.en"),
    ]),
    group("hero", "Hero", [
      s("badge", "Badge above the headline"),
      s("title", "Headline"),
      s("titleAccent", "Headline: the last word, in green"),
      t("lead", "Lead"),
      s("primaryCta", "Main button"),
      s("secondaryCta", "Second button"),
      list("photos", "The four photo slots", [defineField({ name: "image", title: "Photo", type: "imageSlot" }), s("fallbackAlt", "Description of the illustration shown when there's no photo")], "fallbackAlt.en"),
      s("scoreLabel", "Score card: label"),
      s("scoreCaption", "Score card: caption"),
      s("nextLabel", "Next play day: label"),
      s("nextTitle", "Next play day: title"),
      s("nextMeta", "Next play day: details"),
      s("kudos", "Kudos chip"),
    ]),
    group("sports", "Sports row", [s("intro", "Line above the chips")]),
    group("features", "Features (“Everything in your kit bag”)", [
      s("title", "Heading"),
      t("lead", "Lead"),
      list("items", "The seven tools", [
        defineField({ name: "key", title: "Key (don't change)", type: "string", readOnly: true }),
        s("title", "Title"),
        t("body", "Text"),
        defineField({ name: "status", title: "Status", type: "string", options: { list: [{ title: "Live", value: "live" }, { title: "Coming soon", value: "soon" }] } }),
      ]),
      list("sessionRows", "Sample session rows (illustration)", [s("name", "Name"), s("meta", "Details"), s("action", "Button")], "name.en"),
      s("finderCta", "Club finder button"),
      s("mapChip", "Map chip"),
    ]),
    group("vision", "Vision", [
      s("eyebrow", "Eyebrow"),
      s("title", "Heading"),
      t("lead", "Lead"),
      s("primaryCta", "Main button"),
      s("secondaryCta", "Second button"),
      t("note", "Who can use it today"),
      s("figureCaption", "Caption of the sample analysis"),
      list("benefits", "Benefits", titled),
    ]),
    group("how", "How it works", [s("title", "Heading"), list("steps", "Steps", titled), t("storeNote", "Note under the store badges")]),
    group("rankings", "Rankings", [s("eyebrow", "Eyebrow"), s("title", "Heading"), t("lead", "Lead"), t("note", "Note under the illustration"), s("cta", "Link")]),
    group("finder", "Find a club", [s("title", "Heading"), t("lead", "Lead")]),
    group("story", "Story (shown until there is a quote)", [s("title", "Heading"), t("body", "Text"), s("caption", "Caption")]),
    group("clubs", "For clubs", [
      s("eyebrow", "Eyebrow"),
      s("title", "Heading"),
      t("lead", "Lead"),
      s("primaryCta", "Main button"),
      s("secondaryCta", "Second button"),
      list("stats", "Three facts (true numbers only)", [s("value", "Number"), s("label", "Label")], "label.en"),
    ]),
    group("pricing", "Pricing", [
      group("players", "Players", [s("eyebrow", "Eyebrow"), s("price", "Price"), t("body", "Text"), s("cta", "Button")]),
      group("clubs", "Clubs", [s("eyebrow", "Eyebrow"), s("badge", "Badge"), s("price", "Price (words, not numbers)"), t("body", "Text"), t("note", "Note"), s("cta", "Button")]),
    ]),
  ],
  preview: { prepare: () => ({ title: "Home page" }) },
});

const page = defineType({
  name: "page",
  title: "Page",
  type: "document",
  fields: [
    defineField({ name: "key", title: "Page (don't change)", type: "string", readOnly: true, validation: both }),
    s("title", "Title"),
    t("lead", "Lead"),
    s("seoTitle", "Title for search engines"),
    t("seoDescription", "Description for search engines"),
    list("sections", "Sections", [s("heading", "Heading"), t("body", "Text"), defineField({ name: "bullets", title: "Bullet points", type: "array", of: [defineArrayMember({ type: "localeString" })] })], "heading.en"),
  ],
  preview: { select: { title: "title.en", subtitle: "key" } },
});

const sport = defineType({
  name: "sport",
  title: "Sport",
  type: "document",
  fields: [
    defineField({ name: "key", title: "Key", type: "string", validation: both }),
    s("name", "Name"),
    defineField({ name: "status", title: "Status", type: "string", options: { list: [{ title: "Live", value: "live" }, { title: "Coming soon", value: "soon" }], layout: "radio" }, initialValue: "soon", validation: both }),
    defineField({ name: "order", title: "Order", type: "number", validation: both }),
  ],
  orderings: [{ title: "Order", name: "order", by: [{ field: "order", direction: "asc" }] }],
  preview: { select: { title: "name.en", subtitle: "status" } },
});

const club = defineType({
  name: "club",
  title: "Club",
  type: "document",
  description: "Only clubs that have agreed to be listed. True facts only.",
  fields: [
    defineField({ name: "name", title: "Club name", type: "string", validation: both }),
    defineField({ name: "slug", title: "Short name for links", type: "string", validation: both }),
    defineField({ name: "sportKey", title: "Sport (the sport's key, e.g. badminton)", type: "string", validation: both }),
    defineField({ name: "city", title: "City", type: "string", validation: both }),
    defineField({ name: "suburb", title: "Suburb", type: "string" }),
    defineField({ name: "country", title: "Country", type: "string", validation: both }),
    s("schedule", "When they play"),
    s("audience", "Who it's for (e.g. Social play, all levels)"),
    t("description", "Short description"),
    defineField({ name: "url", title: "The club's own page (where a casual session is booked)", type: "url", validation: both }),
    defineField({ name: "logo", title: "Logo", type: "imageSlot" }),
  ],
  preview: { select: { title: "name", subtitle: "city" } },
});

const faqItem = defineType({
  name: "faqItem",
  title: "FAQ item",
  type: "document",
  fields: [
    s("q", "Question"),
    t("a", "Answer"),
    defineField({ name: "topic", title: "Topic", type: "string", options: { list: ["clubs", "players", "general"] }, validation: both }),
    defineField({ name: "order", title: "Order", type: "number", validation: both }),
  ],
  orderings: [{ title: "Order", name: "order", by: [{ field: "order", direction: "asc" }] }],
  preview: { select: { title: "q.en", subtitle: "topic" } },
});

const helpArticle = defineType({
  name: "helpArticle",
  title: "Help article",
  type: "document",
  fields: [
    s("title", "Title"),
    defineField({ name: "slug", title: "Address (after /help/)", type: "string", validation: (rule) => rule.required().regex(/^[a-z0-9-]+$/, { name: "lowercase letters, numbers and dashes" }) }),
    t("summary", "One-sentence summary"),
    defineField({ name: "audience", title: "For", type: "string", options: { list: [{ title: "Organisers", value: "organisers" }, { title: "Players", value: "players" }, { title: "Everyone", value: "everyone" }], layout: "radio" }, validation: both }),
    defineField({ name: "order", title: "Order", type: "number", validation: both }),
    defineField({ name: "updated", title: "Last updated", type: "date", validation: both }),
    defineField({ name: "body", title: "Article", type: "localeBlocks", validation: both }),
  ],
  orderings: [{ title: "Order", name: "order", by: [{ field: "order", direction: "asc" }] }],
  preview: { select: { title: "title.en", subtitle: "audience" } },
});

const legalPage = defineType({
  name: "legalPage",
  title: "Legal page",
  type: "document",
  description: "Website notices only. Use {{company}}, {{address}} and {{contactEmail}} where the company details go (set in Site settings).",
  fields: [
    defineField({ name: "slug", title: "Page", type: "string", options: { list: ["privacy", "terms"] }, readOnly: true, validation: both }),
    s("title", "Title"),
    t("summary", "Summary"),
    defineField({ name: "updated", title: "Last updated (change it whenever the text changes)", type: "date", validation: both }),
    defineField({ name: "body", title: "Text", type: "localeBlocks", validation: both }),
  ],
  preview: { select: { title: "title.en", subtitle: "updated" } },
});

const testimonial = defineType({
  name: "testimonial",
  title: "Quote",
  type: "document",
  description: "Real quotes only, in the person's own words, with their written consent. The home page shows the first one that has consent ticked.",
  fields: [
    t("quote", "Quote"),
    defineField({ name: "name", title: "Name", type: "string", validation: both }),
    s("role", "Role"),
    defineField({ name: "club", title: "Club", type: "string", validation: both }),
    defineField({ name: "consent", title: "This person has agreed in writing to be quoted on the website", type: "boolean", initialValue: false }),
    defineField({ name: "photo", title: "Photo", type: "imageSlot" }),
  ],
  preview: { select: { title: "name", subtitle: "club" } },
});

export const schemaTypes = [
  locale("localeString", "Text in both languages", "string"),
  locale("localeText", "Long text in both languages", "text"),
  richText,
  localeBlocks,
  imageSlot,
  siteSettings,
  homePage,
  page,
  sport,
  club,
  faqItem,
  helpArticle,
  legalPage,
  testimonial,
];
