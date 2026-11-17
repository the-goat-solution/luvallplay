// Is this browser on a phone or tablet? Used to show "Add to Home Screen"
// only where it makes sense (not on laptops, including touchscreen ones).
//
// Order of signals:
// 1. navigator.userAgentData.mobile (Chromium's own answer; false on tablets)
// 2. The user agent: iPhone/iPod/iPad, Android (phones and tablets), other
//    mobile OSes, and in-app browsers (Facebook, Instagram, Zalo…)
// 3. iPadOS, which reports itself as a Mac: "MacIntel" with a touch screen
export function isMobileDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & { userAgentData?: { mobile?: boolean } } = navigator): boolean {
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent || "";
  if (/iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|Silk|Kindle/i.test(ua)) return true;
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|MicroMessenger|Line\/|Zalo/i.test(ua)) return true;
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}
