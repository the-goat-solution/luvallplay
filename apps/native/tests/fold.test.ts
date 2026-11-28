// The iPhone Duo fold in the iOS shell: the native plugin, the build flag that
// turns it on, and the page's side of it. Swift isn't compiled here (the macOS
// CI job does that), so these hold the pieces together.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const swift = read("../ios/App/App/ShellViewController.swift");

test("the fold plugin is named Fold, as the page asks for it, and sends what the page reads", () => {
  assert.match(swift, /jsName = "Fold"/);
  assert.match(read("../../app/src/lib/native/fold.ts"), /plugin<FoldPlugin>\("Fold"\)/);
  assert.match(swift, /notifyListeners\("foldChange"/);
  assert.match(read("../../app/src/lib/native/fold.ts"), /addListener\("foldChange"/);
  for (const key of ["divisions", "width", "height", "x", "y"]) assert.match(swift, new RegExp(`"${key}"`), key);
  assert.match(swift, /reservedRegions\(kind: \.division\)/);
});

test("all the fold code needs the iOS 27.1 SDK, so it compiles only under FOLD_API; an older Xcode builds the shell as before", () => {
  const guarded = swift.split("#if FOLD_API").length - 1;
  assert.equal(guarded, 2);
  assert.equal(swift.split("#endif").length - 1, 2);
  // Nothing of the fold API outside the guards.
  const outside = swift.replace(/#if FOLD_API[\s\S]*?#endif/g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(outside, /reservedRegions|FoldPlugin|FoldProbeView/);
  assert.match(read("../ios/App/App/SceneDelegate.swift"), /rootViewController = ShellViewController\(\)/);
});

test("the Swift file is in the Xcode project, in the app's sources", () => {
  const pbx = read("../ios/App/App.xcodeproj/project.pbxproj");
  assert.match(pbx, /ShellViewController\.swift in Sources/);
  assert.match(pbx, /path = ShellViewController\.swift/);
  assert.equal(pbx.match(/A1B2C3D40000000000E10004/g)?.length, 3, "file reference, group and build file");
  assert.equal(pbx.match(/A1B2C3D40000000000E10005/g)?.length, 2, "build file and sources phase");
});

test("the iOS workflows pick Xcode with one script and pass FOLD_API only when it was set", () => {
  const script = (sdk: string) => execFileSync("bash", [new URL("../scripts/select-xcode.sh", import.meta.url).pathname, "--sdk", sdk]).toString().trim();
  assert.deepEqual(["iphoneos26.2", "iphoneos27.0", "iphoneos27.1", "iphoneos27.2", "iphoneos28.0", ""].map(script), ["0", "0", "1", "1", "1", "0"]);
  for (const file of ["../../../.github/workflows/ios-release.yml", "../../../.github/workflows/ci.yml"]) {
    const w = read(file);
    assert.match(w, /apps\/native\/scripts\/select-xcode\.sh/, file);
    assert.match(w, /\$\{FOLD_API:\+'SWIFT_ACTIVE_COMPILATION_CONDITIONS=\$\(inherited\) FOLD_API'\}/, file);
    assert.match(w, /vars\.IOS_RUNNER \|\| 'macos-15'/, file);
  }
  assert.doesNotMatch(read("../scripts/select-xcode.sh"), /FOLD_API=\$READY/, "a 0 would count as set");
});
