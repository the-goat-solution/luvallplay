// Phone camera selection for the Match Analyzer (iPhone 14 and newer).
// Safari lists each back lens as its own device on recent iOS ("Back Camera",
// "Back Ultra Wide Camera", plus virtual "Dual Wide" / "Triple" cameras that
// switch lenses on their own, which would break the court calibration). We
// prefer the single physical lens the assistant chose. Labels are localised,
// so the assistant can also pick from the list; a zoom constraint is the
// fallback where only a virtual multi-lens camera is exposed.
import type { LensPreset } from "@/lib/ma/lens";

export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|Android.+Mobile/i.test(ua)) return true;
  // iPadOS reports a desktop UA: treat touch + small screen as a phone-like device.
  return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 700;
}

export function lensOfLabel(label: string): LensPreset | null {
  if (/ultra|0[.,]5|siêu rộng/i.test(label)) return "ultrawide";
  if (/dual|triple|tele|front|trước/i.test(label)) return null;
  if (/back|rear|environment|sau/i.test(label)) return "wide";
  return null;
}

export type CameraChoice = { deviceId: string; label: string };

/** Asks for the camera once (labels are hidden until then) and lists the cameras. */
export async function listCameras(): Promise<CameraChoice[]> {
  const tmp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  tmp.getTracks().forEach((t) => t.stop());
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Best device for a lens: a single physical lens with a matching label. */
export function pickCamera(list: CameraChoice[], lens: LensPreset): CameraChoice | null {
  return list.find((c) => lensOfLabel(c.label) === lens) ?? null;
}

/** Opens the camera at 1080p, 60 fps if it can (a sharper shuttle), else 30. */
export async function openCamera(deviceId: string | null, lens: LensPreset): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60, max: 60 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
  };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const track = stream.getVideoTracks()[0];
  // Lock the zoom so a multi-lens camera does not switch lenses mid-game.
  const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  if (caps.zoom) {
    const want = lens === "ultrawide" ? Math.max(caps.zoom.min, 0.5) : Math.max(caps.zoom.min, Math.min(1, caps.zoom.max));
    try {
      await track.applyConstraints({ advanced: [{ zoom: want } as MediaTrackConstraintSet] });
    } catch {
      /* not supported: keep the device's default */
    }
  }
  return stream;
}
