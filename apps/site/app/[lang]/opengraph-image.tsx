import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getContent } from "@/lib/content";
import { LANGS, type Lang } from "@/lib/types";

export const alt = "Luvallplay. Love all, play.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

const font = (file: string) => readFile(`${process.cwd()}/public/fonts/${file}`);

// The social preview, one per language: Court Green, court lines, the mark.
export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const { home } = await getContent();
  const [d1, d2, t1, t2, mark] = await Promise.all([
    font("barlow-condensed-latin-700-normal.woff"),
    font("barlow-condensed-vietnamese-700-normal.woff"),
    font("be-vietnam-pro-latin-400-normal.woff"),
    font("be-vietnam-pro-vietnamese-400-normal.woff"),
    readFile(`${process.cwd()}/public/brand/luvallplay-lockup-dark.svg`, "utf8"),
  ]);
  const logo = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(160deg,#13785a,#0e6b4f 45%,#0b5c44)", color: "#fafaf7", position: "relative" }}>
        <div style={{ position: "absolute", left: 32, top: 32, right: 32, bottom: 32, border: "3px solid rgba(250,250,247,0.22)", borderRadius: 24, display: "flex" }} />
        <div style={{ position: "absolute", left: 600, top: 32, bottom: 32, borderLeft: "3px solid rgba(250,250,247,0.22)", display: "flex" }} />
        <img src={logo} alt="" width={364} height={70} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: lang === "vi" ? 92 : 120, lineHeight: 1, fontWeight: 700 }}>
            {`${home.hero.title[lang]} ${home.hero.titleAccent[lang]}`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontFamily: "Text", fontSize: 30 }}>
            <span style={{ background: "#d4f23c", color: "#0b1b2b", padding: "8px 22px", borderRadius: 999, display: "flex" }}>Love all, play.</span>
            <span style={{ display: "flex" }}>{home.sports.intro[lang].split(". ")[0]}.</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Display", data: d1, weight: 700, style: "normal" },
        { name: "Display", data: d2, weight: 700, style: "normal" },
        { name: "Text", data: t1, weight: 400, style: "normal" },
        { name: "Text", data: t2, weight: 400, style: "normal" },
      ],
    },
  );
}
