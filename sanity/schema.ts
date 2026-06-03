import { defineType, defineField } from "sanity";

const localeString = defineType({
  name: "localeString",
  title: "Localized string",
  type: "object",
  fields: [
    { name: "en", type: "string", title: "English" },
    { name: "vi", type: "string", title: "Vietnamese" },
  ],
});

const localeText = defineType({
  name: "localeText",
  title: "Localized text",
  type: "object",
  fields: [
    { name: "en", type: "text", title: "English" },
    { name: "vi", type: "text", title: "Vietnamese" },
  ],
});

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({ name: "phone", type: "string", title: "Phone" }),
    defineField({ name: "email", type: "string", title: "Email" }),
    defineField({ name: "googleReviewUrl", type: "url", title: "Google Review URL" }),
    defineField({ name: "facebookUrl", type: "url", title: "Facebook URL" }),
    defineField({
      name: "stats",
      type: "object",
      fields: [
        { name: "sessionsPerYear", type: "string" },
        { name: "activeMembers", type: "string" },
        { name: "established", type: "string" },
      ],
    }),
  ],
});

export const hero = defineType({
  name: "hero",
  title: "Hero",
  type: "document",
  fields: [
    defineField({ name: "tagline", type: "localeText" }),
    defineField({ name: "backgroundImage", type: "image" }),
  ],
});

export const aboutSection = defineType({
  name: "aboutSection",
  title: "About",
  type: "document",
  fields: [
    defineField({ name: "title", type: "localeString" }),
    defineField({ name: "body1", type: "localeText" }),
    defineField({ name: "body2", type: "localeText" }),
    defineField({ name: "imageMain", type: "image" }),
    defineField({ name: "imageSecondary", type: "image" }),
  ],
});

export const galleryImage = defineType({
  name: "galleryImage",
  title: "Gallery Image",
  type: "document",
  fields: [
    defineField({ name: "image", type: "image", options: { hotspot: true } }),
    defineField({ name: "alt", type: "localeString" }),
    defineField({ name: "order", type: "number" }),
  ],
});

export const review = defineType({
  name: "review",
  title: "Review",
  type: "document",
  fields: [
    defineField({ name: "quote", type: "localeText" }),
    defineField({ name: "authorName", type: "string" }),
    defineField({ name: "authorInitial", type: "string" }),
    defineField({ name: "membershipType", type: "string" }),
    defineField({ name: "order", type: "number" }),
  ],
});

export const pricingPlan = defineType({
  name: "pricingPlan",
  title: "Pricing Plan",
  type: "document",
  fields: [
    defineField({
      name: "planId",
      type: "string",
      options: {
        list: [
          { title: "Casual", value: "casual" },
          { title: "Monthly", value: "monthly" },
          { title: "Quarterly", value: "quarterly" },
        ],
      },
    }),
    defineField({ name: "name", type: "localeString" }),
    defineField({ name: "description", type: "localeText" }),
    defineField({ name: "priceNzd", type: "number" }),
    defineField({ name: "periodLabel", type: "localeString" }),
    defineField({ name: "featured", type: "boolean" }),
    defineField({ name: "stripePriceId", type: "string" }),
    defineField({ name: "features", type: "array", of: [{ type: "localeString" }] }),
    defineField({ name: "order", type: "number" }),
  ],
});

export const scheduleSettings = defineType({
  name: "scheduleSettings",
  title: "Schedule Settings",
  type: "document",
  fields: [
    defineField({ name: "venueName", type: "localeString" }),
    defineField({ name: "address", type: "localeString" }),
    defineField({ name: "timeLabel", type: "localeString" }),
    defineField({ name: "maxCasualSpots", type: "number", initialValue: 8 }),
    defineField({ name: "bookingLockDays", type: "number", initialValue: 14 }),
  ],
});

export const schemaTypes = [
  localeString,
  localeText,
  siteSettings,
  hero,
  aboutSection,
  galleryImage,
  review,
  pricingPlan,
  scheduleSettings,
];
