import { test } from "node:test";
import assert from "node:assert/strict";
import { stripJpegGps } from "../lib/exif-gps.ts";

/** A minimal JPEG with an EXIF block: IFD0 → GPS IFD with latitude (RATIONAL×3). */
function jpegWithGps(littleEndian: boolean): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (littleEndian ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  // IFD0 at 8: 2 entries (Orientation, GPSInfo pointer), next = 0
  tiff.push(...u16(2));
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0); // Orientation = 6
  tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(38)); // GPS IFD at 38
  tiff.push(...u32(0));
  // GPS IFD at 38: 2 entries: LatitudeRef "S", Latitude rationals at 68, next = 0
  tiff.push(...u16(2));
  tiff.push(...u16(0x0001), ...u16(2), ...u32(2), 0x53, 0, 0, 0);
  tiff.push(...u16(0x0002), ...u16(5), ...u32(3), ...u32(68));
  tiff.push(...u32(0));
  // rationals at 68: 43/1, 31/1, 4512/100
  tiff.push(...u32(43), ...u32(1), ...u32(31), ...u32(1), ...u32(4512), ...u32(100));
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

for (const le of [true, false]) {
  test(`stripJpegGps removes location, keeps everything else (${le ? "little" : "big"}-endian)`, () => {
    const input = jpegWithGps(le);
    const { bytes, hadGps } = stripJpegGps(input);
    assert.equal(hadGps, true);
    assert.equal(bytes.length, input.length, "same size: nothing re-encoded");
    const tiff = 12; // FFD8 FFE1 len(2) "Exif\0\0"
    // GPS IFD now has zero entries
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(tiff + 38, le), 0);
    // Latitude values zeroed
    assert.deepEqual([...bytes.slice(tiff + 68, tiff + 92)], new Array(24).fill(0));
    // Orientation entry untouched
    assert.equal(view.getUint16(tiff + 10, le), 0x0112);
    assert.equal(view.getUint16(tiff + 18, le), 6);
    // Image data marker untouched
    assert.deepEqual([...bytes.slice(-6)], [0xff, 0xda, 0, 2, 0xff, 0xd9]);
  });
}

test("stripJpegGps leaves non-JPEG and GPS-free files alone", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(stripJpegGps(png), { bytes: png, hadGps: false });
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  assert.equal(stripJpegGps(plain).hadGps, false);
});
