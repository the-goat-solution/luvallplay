import { test } from "node:test";
import assert from "node:assert/strict";
import { isMobileDevice } from "../lib/device.ts";

const nav = (userAgent: string, platform = "", maxTouchPoints = 0, mobile?: boolean) => ({
  userAgent,
  platform,
  maxTouchPoints,
  ...(mobile === undefined ? {} : { userAgentData: { mobile } }),
});

test("phones and tablets count as mobile", () => {
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", "iPhone", 5)), true);
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36", "Linux armv8l", 5, true)), true);
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "Linux", 10, false)), true, "Android tablet");
  // iPadOS asks for desktop sites and reports a Mac.
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15", "MacIntel", 5)), true, "iPad");
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) [FBAN/FBIOS;FBAV/500.0]", "iPhone", 5)), true, "Facebook in-app");
});

test("desktops and touchscreen laptops do not", () => {
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15", "MacIntel", 0)), false, "Mac");
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "Win32", 10, false)), false, "Windows touch laptop");
  assert.equal(isMobileDevice(nav("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "Linux x86_64", 0, false)), false, "Linux");
});
