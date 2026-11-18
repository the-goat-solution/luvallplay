// Person detections from two passes of the detector: the whole frame, and a
// closer look at the far half of the court (see MatchEngine.farRoi). Boxes
// from the crop are mapped back to video pixels and merged: where both passes
// found the same person (overlap), the more confident box is kept.
import { iou, type Detection } from "../match-analyzer.ts";

/** Crop-pass boxes (in crop pixels of a cw×ch image) → video pixels. */
export function fromCrop(dets: Detection[], roi: [number, number, number, number], cw: number, ch: number): Detection[] {
  const sx = roi[2] / cw, sy = roi[3] / ch;
  return dets.map((d) => ({ ...d, box: [roi[0] + d.box[0] * sx, roi[1] + d.box[1] * sy, d.box[2] * sx, d.box[3] * sy] as Detection["box"] }));
}

/**
 * Union of the two passes without duplicates. A crop box cut by the crop's
 * edge (a near player's head poking into it) is dropped: the full frame sees
 * that person whole.
 */
export function mergeDetections(full: Detection[], crop: Detection[], roi: [number, number, number, number]): Detection[] {
  const [rx, ry, rw, rh] = roi;
  const edge = 3;
  const inner = crop.filter((d) => d.box[0] > rx + edge && d.box[1] > ry + edge && d.box[0] + d.box[2] < rx + rw - edge && d.box[1] + d.box[3] < ry + rh - edge);
  const out = [...full];
  for (const d of inner) {
    const k = out.findIndex((o) => iou(o.box, d.box) > 0.4);
    if (k < 0) out.push(d);
    else if (d.score > out[k].score) out[k] = { ...d, look: out[k].look };
  }
  return out;
}
