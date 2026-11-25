// Optimal assignment (Hungarian / Kuhn–Munkres, O(n³)). Used to match the
// detected people in a frame to the four players with the lowest total cost,
// instead of greedily: with partners in the same shirts, the greedy choice of
// the single closest pair is exactly what causes identity switches.

/**
 * Minimum-cost assignment for a rows × cols cost matrix (rectangular allowed).
 * Returns, for each row, the assigned column or -1. Costs ≥ `forbidden` are
 * never used.
 */
export function hungarian(cost: number[][], forbidden = 1e6): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  const size = Math.max(n, m);
  const BIG = forbidden * 10;
  const a = (i: number, j: number) => (i < n && j < m ? Math.min(cost[i][j], BIG) : BIG / 10);
  // e-maxx formulation, 1-indexed.
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);
  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(Infinity);
    const used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    const i = p[j] - 1;
    const c = j - 1;
    if (i >= 0 && i < n && c < m && cost[i][c] < forbidden) out[i] = c;
  }
  return out;
}
