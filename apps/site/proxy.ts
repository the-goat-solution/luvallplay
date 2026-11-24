// Language routing. Every page lives under /en or /vi.
//
// A path without a language is redirected to one: the visitor's saved choice
// (the `lang` cookie), else Vietnamese on the .vn domain, else the browser's
// language, else English. Visiting a page in a language saves that choice, so
// the visible switch is remembered. `lang` is the site's only cookie.
import { NextResponse, type NextRequest } from "next/server";

const YEAR = 60 * 60 * 24 * 365;

export function pickLang(cookie: string | undefined, host: string, acceptLanguage: string | null): "en" | "vi" {
  if (cookie === "en" || cookie === "vi") return cookie;
  if (host.replace(/:\d+$/, "").endsWith(".vn")) return "vi";
  const first = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q)
    .find((x) => x.tag.startsWith("vi") || x.tag.startsWith("en"));
  return first?.tag.startsWith("vi") ? "vi" : "en";
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const saved = req.cookies.get("lang")?.value;
  const match = /^\/(en|vi)(\/|$)/.exec(pathname);
  if (match) {
    const res = NextResponse.next();
    if (saved !== match[1]) res.cookies.set("lang", match[1], { maxAge: YEAR, path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:" });
    return res;
  }
  const lang = pickLang(saved, req.headers.get("host") ?? "", req.headers.get("accept-language"));
  const url = req.nextUrl.clone();
  url.pathname = `/${lang}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Not for API routes, Next's own files, or anything with a file extension.
  matcher: ["/((?!api/|_next/|brand/|.*\\.[a-z0-9]+$).*)"],
};
