# App icons

Every icon is drawn from the Luvallplay mark (`apps/site/public/brand/luvallplay-mark.svg`;
its two paths are in `mark-paths.json`) by `scripts/icons.mjs`. Change the script, then run
`pnpm --filter app icons`; don't edit the PNGs.

**The design.** A Court Green background lit from the top left, and the mark in two
gradients: the figure in Smash Lime, the heart in Rally Coral. The masters are full-bleed
squares with no rounded corners, shadows or glows: iOS and Android mask them and add
their own depth and highlights. The mark stays inside each platform's safe area.

| Where | Files |
| --- | --- |
| Web app (`public/`) | `icon.svg`, `icon-192.png`, `icon-512.png` (rounded, shown as they are); `icon-maskable-192/512.png` (full-bleed, mark inside the 40% safe circle); `icon-monochrome-512.png` (themed icons); `apple-touch-icon.png` (180); `favicon.ico` (16 + 32) |
| iOS (`ios/`) | `AppIcon.appiconset`: the 1024 px default, dark and tinted appearances (iOS 18+), ready for Xcode. `layers/`: background (light and dark), figure and heart as 1024 px layers to import into Icon Composer for iOS 26's Liquid Glass (clear and tinted come from the same layers) |
| Android (`android/`) | `res/mipmap-*`: adaptive icon background, foreground (mark inside the 66 dp circle) and monochrome layers for mdpi–xxxhdpi, plus legacy square and round icons; `mipmap-anydpi-v26/ic_launcher*.xml`; `play-store-512.png` (full square, Play adds the mask) |
