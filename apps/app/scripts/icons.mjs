// Builds every app icon from the Luvallplay mark (icons/mark-paths.json, the
// two paths of apps/site/public/brand/luvallplay-mark.svg), so all sizes and
// platforms stay the same drawing. Run: pnpm --filter app icons
//
// The design, following Apple's and Google's current guidance:
// - one full-bleed, opaque background: a Court Green gradient lit from the
//   top (it reads as depth, and takes the system's lighting well);
// - the mark on top in two gradients: the figure in Smash Lime, the heart in
//   Rally Coral. Lime on green is the brand's strongest contrast;
// - no baked masks, rounded corners, shadows or glows on the platform
//   masters: iOS (Liquid Glass) and Android add their own;
// - the mark centred, inside each platform's safe area (Android's 66/108 dp
//   circle, the maskable icon's 40% radius);
// - a dark variant (deep ink background), and a grayscale one for iOS
//   tinted and clear appearances and Android's themed icons.
//
// Outputs:
//   public/            the web app's icons (manifest, Apple touch icon, favicons)
//   icons/ios/         the asset catalog's 1024 px masters (default, dark, tinted) and Icon Composer layers
//   icons/android/     adaptive icon layers per density, legacy and round icons, the Play Store icon
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");
const { body, heart } = JSON.parse(readFileSync(path.join(ROOT, "icons/mark-paths.json"), "utf8"));

// The mark's own box, in its path units.
const MARK = { x: 64.4, y: 60, w: 615.5, h: 601 };
const HALF_DIAGONAL = Math.hypot(MARK.w, MARK.h) / 2;

// Brand colours (packages/ui/src/luvallplay.ts), with lighter and deeper steps for the gradients.
const C = {
  green: ["#1fa77a", "#0e6b4f", "#074634"],
  lime: ["#efff8a", "#d4f23c", "#b5d21d"],
  coral: ["#ff9a7d", "#ff6b4a", "#ec4a2a"],
  ink: ["#1b3550", "#0b1b2b", "#050d16"],
};

/** The mark as SVG, its box scaled to `width` px and centred at (cx, cy) on a `size` canvas. */
function mark({ size, width, cx = size / 2, cy = size / 2, look }) {
  const k = width / MARK.w;
  const tx = cx - (MARK.x + MARK.w / 2) * k;
  const ty = cy - (MARK.y + MARK.h / 2) * k;
  const fill = (part) =>
    look === "mono" ? "#ffffff" : look === "gray" ? (part === "heart" ? "url(#gh)" : "url(#gb)") : part === "heart" ? "url(#heart)" : "url(#body)";
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(5)})"><path fill="${fill("body")}" d="${body}"/><path fill="${fill("heart")}" d="${heart}"/></g>`;
}

/** Scale for a mark that fits inside a circle of `radius` px. */
const widthInCircle = (radius) => (radius / HALF_DIAGONAL) * MARK.w;

function defs() {
  // Gradients in the mark's own units, so they follow it at any size.
  const lin = (id, [a, b, c], y1 = MARK.y, y2 = MARK.y + MARK.h) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="0" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  return `<defs>
    ${lin("body", C.lime, 200, 660)}
    ${lin("heart", C.coral, 60, 420)}
    ${lin("gb", ["#ffffff", "#f2f2f2", "#d9d9d9"], 200, 660)}
    ${lin("gh", ["#e6e6e6", "#cfcfcf", "#b3b3b3"], 60, 420)}
    <radialGradient id="bg-light" cx="0.32" cy="0.18" r="0.95"><stop offset="0" stop-color="${C.green[0]}"/><stop offset="0.55" stop-color="${C.green[1]}"/><stop offset="1" stop-color="${C.green[2]}"/></radialGradient>
    <radialGradient id="bg-dark" cx="0.32" cy="0.18" r="0.95"><stop offset="0" stop-color="${C.ink[0]}"/><stop offset="0.6" stop-color="${C.ink[1]}"/><stop offset="1" stop-color="${C.ink[2]}"/></radialGradient>
  </defs>`;
}

/** A background: full square, or a rounded square (for icons the platform shows as they are). */
function background(size, look, radius = 0) {
  if (look === "none") return "";
  const fill = look === "dark" ? "url(#bg-dark)" : look === "black" ? "#000000" : "url(#bg-light)";
  return `<rect width="${size}" height="${size}" rx="${radius}" fill="${fill}"/>`;
}

function svg({ size, bg = "light", radius = 0, markWidth, markLook = "color", cy }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs()}${background(size, bg, radius)}${markWidth ? mark({ size, width: markWidth, look: markLook, cy }) : ""}</svg>`;
}

// ── What to make ─────────────────────────────────────────────────────────────
// Sizes are on a 1024 master and scaled; `out` sizes are the rendered pixels.
const M = 1024;
const IOS_MARK = 0.6 * M; // centred; Apple's grid keeps primary content well inside
const ANY_MARK = 0.62 * M; // a web icon shown as it is, on a rounded square
const SMALL_MARK = 0.74 * M; // favicons: the mark fills more at 16–32 px
const ADAPTIVE_MARK = widthInCircle((66 / 108 / 2) * M) * 0.98; // inside Android's 66 dp circle
const MASKABLE_MARK = widthInCircle(0.4 * M) * 0.98; // inside the maskable icon's safe zone (a circle of 40% radius)
const ROUND = 0.225 * M; // the rounded square of web icons shown unmasked

const jobs = [];
const add = (file, size, spec, transparent = false) => jobs.push({ file, size, spec: { size: M, ...spec }, transparent });

// Web app (public/): the manifest's icons, the Apple touch icon, favicons.
add("public/icon-192.png", 192, { radius: ROUND, markWidth: ANY_MARK }, true);
add("public/icon-512.png", 512, { radius: ROUND, markWidth: ANY_MARK }, true);
add("public/icon-maskable-192.png", 192, { markWidth: MASKABLE_MARK });
add("public/icon-maskable-512.png", 512, { markWidth: MASKABLE_MARK });
add("public/icon-monochrome-512.png", 512, { bg: "none", markWidth: MASKABLE_MARK, markLook: "mono" }, true);
add("public/apple-touch-icon.png", 180, { markWidth: IOS_MARK });
add("public/favicon-32.png", 32, { radius: ROUND, markWidth: SMALL_MARK }, true);
add("public/favicon-16.png", 16, { radius: ROUND, markWidth: SMALL_MARK }, true);

// iOS (icons/ios/): 1024 px masters and Icon Composer layers.
add("icons/ios/AppIcon.appiconset/AppIcon-1024.png", 1024, { markWidth: IOS_MARK });
add("icons/ios/AppIcon.appiconset/AppIcon-1024-dark.png", 1024, { bg: "dark", markWidth: IOS_MARK });
add("icons/ios/AppIcon.appiconset/AppIcon-1024-tinted.png", 1024, { bg: "black", markWidth: IOS_MARK, markLook: "gray" });
add("icons/ios/layers/0-background.png", 1024, {});
add("icons/ios/layers/0-background-dark.png", 1024, { bg: "dark" });

// Android (icons/android/): adaptive layers per density, legacy icons, the Play Store icon.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  add(`icons/android/res/mipmap-${d}/ic_launcher_background.png`, 108 * k, {});
  add(`icons/android/res/mipmap-${d}/ic_launcher_foreground.png`, 108 * k, { bg: "none", markWidth: ADAPTIVE_MARK }, true);
  add(`icons/android/res/mipmap-${d}/ic_launcher_monochrome.png`, 108 * k, { bg: "none", markWidth: ADAPTIVE_MARK, markLook: "mono" }, true);
  add(`icons/android/res/mipmap-${d}/ic_launcher.png`, 48 * k, { radius: ROUND, markWidth: ANY_MARK }, true);
  add(`icons/android/res/mipmap-${d}/ic_launcher_round.png`, 48 * k, { radius: M / 2, markWidth: widthInCircle(0.42 * M) }, true);
}
add("icons/android/play-store-512.png", 512, { markWidth: IOS_MARK });

// ── Vector files ─────────────────────────────────────────────────────────────
const write = (rel, text) => {
  mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  writeFileSync(path.join(ROOT, rel), text);
};
// The web app's SVG icon (any size; also the favicon).
write("public/icon.svg", svg({ size: M, radius: ROUND, markWidth: ANY_MARK }));
// Icon Composer layers (iOS 26+): import these, background first.
write("icons/ios/layers/0-background.svg", svg({ size: M }));
write("icons/ios/layers/1-figure.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}" viewBox="0 0 ${M} ${M}">${defs()}${mark({ size: M, width: IOS_MARK }).replace(/<path fill="url\(#heart\)"[^>]*\/>/, "")}</svg>`);
write("icons/ios/layers/2-heart.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}" viewBox="0 0 ${M} ${M}">${defs()}${mark({ size: M, width: IOS_MARK }).replace(/<path fill="url\(#body\)"[^>]*\/>/, "")}</svg>`);

// An Xcode asset catalog (iOS 18+ single size, with dark and tinted appearances), for the Capacitor app.
write(
  "icons/ios/AppIcon.appiconset/Contents.json",
  `${JSON.stringify(
    {
      images: [
        { filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        { appearances: [{ appearance: "luminosity", value: "dark" }], filename: "AppIcon-1024-dark.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        { appearances: [{ appearance: "luminosity", value: "tinted" }], filename: "AppIcon-1024-tinted.png", idiom: "universal", platform: "ios", size: "1024x1024" },
      ],
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  )}\n`,
);
// Android's adaptive icon (API 26+), with the monochrome layer for themed icons (API 33+).
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
write("icons/android/res/mipmap-anydpi-v26/ic_launcher.xml", adaptive);
write("icons/android/res/mipmap-anydpi-v26/ic_launcher_round.xml", adaptive);

// ── Render ───────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = {};
for (const job of jobs) {
  await page.setViewportSize({ width: job.size, height: job.size });
  const markup = svg(job.spec).replace(`width="${M}" height="${M}"`, `width="${job.size}" height="${job.size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  const file = path.join(ROOT, job.file);
  mkdirSync(path.dirname(file), { recursive: true });
  pngs[job.file] = await page.screenshot({ path: file, omitBackground: job.transparent, clip: { x: 0, y: 0, width: job.size, height: job.size } });
}
await browser.close();

// favicon.ico: the 16 and 32 px PNGs in one file (an ICO may hold PNG images).
const ico = (images) => {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size, e);
    head.writeUInt8(size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
};
writeFileSync(path.join(ROOT, "public/favicon.ico"), ico([{ size: 16, data: pngs["public/favicon-16.png"] }, { size: 32, data: pngs["public/favicon-32.png"] }]));
console.log(`icons: ${jobs.length} PNGs, favicon.ico, SVG layers, the iOS asset catalog and Android's adaptive icon`);
