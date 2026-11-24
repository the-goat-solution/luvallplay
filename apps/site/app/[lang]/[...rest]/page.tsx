import { notFound } from "next/navigation";

// Anything else under /en or /vi is the 404 page, in that language.
export const metadata = { title: "404 · Luvallplay", robots: { index: false, follow: false } };
export const dynamic = "force-static";
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}
export default function CatchAll() {
  notFound();
}
