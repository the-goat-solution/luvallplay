// The small markdown subset used by help articles and legal pages, turned
// into Portable Text (the format Sanity stores and the site renders).
// Supported: ## and ### headings, paragraphs, "-" bullets, "1." numbered
// lists, **bold** and [links](…).

import type { PtBlock, PtLink, PtSpan } from "./types.ts";

export function parseFrontmatter(src: string): { data: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    let v = line.slice(i + 1).split(" #")[0].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\"/g, '"');
    data[line.slice(0, i).trim()] = v;
  }
  return { data, body: src.slice(m[0].length) };
}

function inline(text: string, key: string): { children: PtSpan[]; markDefs: PtLink[] } {
  const children: PtSpan[] = [];
  const markDefs: PtLink[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  const push = (t: string, marks: string[]) => {
    if (t) children.push({ _type: "span", _key: `${key}s${n++}`, text: t, marks });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index), []);
    if (m[1] !== undefined) push(m[1], ["strong"]);
    else {
      const linkKey = `${key}l${markDefs.length}`;
      markDefs.push({ _type: "link", _key: linkKey, href: m[3] });
      push(m[2], [linkKey]);
    }
    last = m.index + m[0].length;
  }
  push(text.slice(last), []);
  if (!children.length) push(" ", []);
  return { children, markDefs };
}

export function markdownToBlocks(md: string): PtBlock[] {
  const blocks: PtBlock[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  const add = (text: string, style: PtBlock["style"], listItem?: PtBlock["listItem"]) => {
    const key = `b${blocks.length}`;
    blocks.push({ _type: "block", _key: key, style, ...(listItem ? { listItem, level: 1 } : {}), ...inline(text.trim(), key) });
  };
  const flush = () => {
    if (para.length) add(para.join(" "), "normal");
    para = [];
  };
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if (!line.trim()) flush();
    else if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flush();
      add(m[2], m[1].length === 2 ? "h2" : "h3");
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flush();
      add(m[1], "normal", "bullet");
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      add(m[1], "normal", "number");
    } else if (/^\s{2,}\S/.test(line) && !para.length && blocks.at(-1)?.listItem) {
      // A wrapped list line: join it to the item above.
      const prev = blocks.pop()!;
      add(prev.children.map((c) => c.text).join("") + " " + line.trim(), "normal", prev.listItem);
    } else para.push(line.trim());
  }
  flush();
  return blocks;
}

export function blocksToText(blocks: PtBlock[]): string {
  return blocks.map((b) => b.children.map((c) => c.text).join("")).join("\n");
}
