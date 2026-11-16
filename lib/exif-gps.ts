// Removes GPS location from a JPEG's EXIF data in place, without touching
// the image itself (no re-compression, same file size). Every other EXIF
// field (camera, date, orientation) is kept. Works on raw bytes, so it runs
// in the browser before upload (and in tests under Node).
//
// How: find the APP1 "Exif" segment, read IFD0, follow the GPSInfo (0x8825)
// pointer to the GPS IFD, zero every value it points to, then empty the IFD
// (entry count 0, entries zeroed). Readers then see a valid, empty GPS IFD.

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };

export type GpsStripResult = { bytes: Uint8Array; hadGps: boolean };

export function stripJpegGps(input: Uint8Array): GpsStripResult {
  const bytes = new Uint8Array(input); // copy
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { bytes, hadGps: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // Markers without a length (fill bytes, RSTn) — skip.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const segLen = view.getUint16(offset + 2);
    if (segLen < 2) break;
    const segStart = offset + 4;
    if (
      marker === 0xe1 &&
      segStart + 6 <= bytes.length &&
      bytes[segStart] === 0x45 && // E
      bytes[segStart + 1] === 0x78 && // x
      bytes[segStart + 2] === 0x69 && // i
      bytes[segStart + 3] === 0x66 && // f
      bytes[segStart + 4] === 0 &&
      bytes[segStart + 5] === 0
    ) {
      const tiff = segStart + 6;
      const segEnd = offset + 2 + segLen;
      const hadGps = clearGpsIfd(view, bytes, tiff, segEnd);
      return { bytes, hadGps };
    }
    offset += 2 + segLen;
  }
  return { bytes, hadGps: false };
}

function clearGpsIfd(view: DataView, bytes: Uint8Array, tiff: number, end: number): boolean {
  if (tiff + 8 > end) return false;
  const order = view.getUint16(tiff);
  const le = order === 0x4949; // "II"
  if (!le && order !== 0x4d4d) return false;
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return false;
  const count0 = u16(ifd0);
  let gpsPtr = -1;
  for (let i = 0; i < count0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x8825) {
      gpsPtr = u32(e + 8);
      break;
    }
  }
  if (gpsPtr < 0) return false;
  const gps = tiff + gpsPtr;
  if (gps + 2 > end) return false;
  const n = u16(gps);
  for (let i = 0; i < n; i++) {
    const e = gps + 2 + i * 12;
    if (e + 12 > end) break;
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = (TYPE_SIZES[type] ?? 1) * count;
    if (size > 4) {
      const at = tiff + u32(e + 8);
      if (at >= 0 && at + size <= end) bytes.fill(0, at, at + size);
    }
    bytes.fill(0, e, e + 12);
  }
  // Empty IFD: zero entries; the "next IFD" pointer that follows is now 0.
  view.setUint16(gps, 0, le);
  return true;
}
