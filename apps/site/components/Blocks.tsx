// Renders the small Portable Text subset the site stores (lib/markdown.ts).
import type { ReactNode } from "react";
import { href } from "@/lib/site";
import type { Lang, PtBlock } from "@/lib/types";

export type Vars = Record<string, string>;
const fill = (s: string, vars: Vars) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

function spans(b: PtBlock, lang: Lang, vars: Vars): ReactNode[] {
  return b.children.map((c) => {
    let node: ReactNode = fill(c.text, vars);
    for (const mark of c.marks ?? []) {
      if (mark === "strong") node = <strong>{node}</strong>;
      else {
        const def = b.markDefs?.find((d) => d._key === mark);
        if (def) {
          const to = fill(def.href, vars);
          const external = /^https?:/.test(to);
          node = <a href={external || to.startsWith("mailto:") ? to : href(lang, to)} rel={external ? "noopener" : undefined}>{node}</a>;
        }
      }
    }
    return <span key={c._key}>{node}</span>;
  });
}

export function Blocks({ blocks, lang, vars = {} }: { blocks: PtBlock[]; lang: Lang; vars?: Vars }) {
  const out: ReactNode[] = [];
  let list: { type: "bullet" | "number"; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.type === "number" ? "ol" : "ul";
    out.push(<L key={`l${out.length}`}>{list.items}</L>);
    list = null;
  };
  for (const b of blocks ?? []) {
    if (b.listItem) {
      if (!list || list.type !== b.listItem) {
        flush();
        list = { type: b.listItem, items: [] };
      }
      list.items.push(<li key={b._key}>{spans(b, lang, vars)}</li>);
      continue;
    }
    flush();
    const T = b.style === "h2" ? "h2" : b.style === "h3" ? "h3" : "p";
    out.push(<T key={b._key}>{spans(b, lang, vars)}</T>);
  }
  flush();
  return <div className="prose">{out}</div>;
}
