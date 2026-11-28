// The fold of a foldable iPhone (iPhone Duo), in the store app's web view.
//
// Safari can give a page the fold (Viewport Segments), but only behind a
// feature flag, and not at all in WKWebView, which is where the iOS store app
// runs the page. So the shell tells the page: the native `Fold` plugin reads
// the division regions UIKit reports (`reservedRegions(kind: .division)`, iOS
// 27.1) and sends their frames, in points, which are CSS pixels. Here they
// become what the same CSS reads from Viewport Segments in a browser:
// `data-fold="vertical"` on <html> while the phone is partly open like a book,
// and the segments' edges as `--seg-N-left|right|width`, so styles/fold-*.css
// (generated from the viewport-segments media queries) apply the same rules.
import { plugin } from "./platform.ts";

export type Division = { x: number; y: number; width: number; height: number };
export type FoldReport = { divisions: Division[]; width: number; height: number };
export type Fold = { orientation: "vertical" | "horizontal" | null; vars: Record<string, string> };

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * What the page sees from the fold. A division that runs top to bottom (taller
 * than wide) splits the screen into two side-by-side segments (a book); one
 * that runs side to side (the phone set down like a laptop) into an upper and
 * a lower. Only the first division counts, and one that doesn't cross the
 * screen is ignored.
 */
export function foldFrom(report: FoldReport): Fold {
  const none: Fold = { orientation: null, vars: {} };
  const d = report.divisions.find((r) => r.width > 0 && r.height > 0);
  if (!d || !(report.width > 0) || !(report.height > 0)) return none;
  const vertical = d.height >= d.width;
  if (vertical) {
    const left = d.x;
    const right = d.x + d.width;
    if (left <= 0 || right >= report.width) return none;
    return {
      orientation: "vertical",
      vars: {
        "--seg-0-left": px(0), "--seg-0-right": px(left), "--seg-0-width": px(left),
        "--seg-1-left": px(right), "--seg-1-right": px(report.width), "--seg-1-width": px(report.width - right),
      },
    };
  }
  const top = d.y;
  const bottom = d.y + d.height;
  if (top <= 0 || bottom >= report.height) return none;
  return {
    orientation: "horizontal",
    vars: {
      "--seg-0-top": px(0), "--seg-0-bottom": px(top), "--seg-0-height": px(top),
      "--seg-1-top": px(bottom), "--seg-1-bottom": px(report.height), "--seg-1-height": px(report.height - bottom),
    },
  };
}

type Root = Pick<HTMLElement, "style" | "removeAttribute" | "setAttribute">;

/** Puts the fold on <html>, taking away what an earlier fold left. */
export function applyFold(fold: Fold, root: Root = document.documentElement): void {
  for (const name of [...Array.from({ length: 2 }, (_, n) => ["left", "right", "width", "top", "bottom", "height"].map((s) => `--seg-${n}-${s}`)).flat()]) root.style.removeProperty(name);
  if (!fold.orientation) {
    root.removeAttribute("data-fold");
    return;
  }
  for (const [name, value] of Object.entries(fold.vars)) root.style.setProperty(name, value);
  root.setAttribute("data-fold", fold.orientation);
}

type Handle = { remove(): Promise<void> } | Promise<{ remove(): Promise<void> }>;
export type FoldPlugin = {
  get(): Promise<FoldReport>;
  addListener(event: "foldChange", listener: (report: FoldReport) => void): Handle;
};

/** Follows the shell's fold report. Does nothing where the shell has no `Fold` plugin (a browser, Android, an older build, an iPhone with no fold). */
export function startFold(root: Root = document.documentElement, native: FoldPlugin | undefined = plugin<FoldPlugin>("Fold")): void {
  if (!native) return;
  const show = (report: FoldReport) => applyFold(foldFrom(report), root);
  void native.addListener("foldChange", show);
  void native.get().then(show).catch(() => {});
}
