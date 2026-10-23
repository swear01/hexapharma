// Narrow-pass solvability: BFS over machine stamps with swamp half steps (heading ignored, and the tentative heading-relative rules).
// Only the pass corridor plus a 2-cell pocket at each end is walkable, so a solution must thread the narrow core.
import { cells, passes, DQ, DR } from "./map.mjs";
const { cells: list } = cells(); const byKey = new Map(list.map((c) => [c.key, c]));
// catalog paths in the game's E,SE,SW,W,NW,NE order -> convert to this file's ccw order (E,NE,NW,W,SW,SE)
const G2L = [0, 5, 4, 3, 2, 1];
const CAT = { hook: [0, 0, 1], elbow: [5, 5, 0], return: [3, 3, 4], wave: [0, 5, 0, 1, 0, 1, 0], zigzag: [1, 0, 1, 0], loop: [0, 1, 2, 3, 4, 5, 0], straight: [0, 0, 0, 0], crane: [0, 0, 0, 5, 5] };
const BASIC = ["hook", "elbow", "return", "wave"];
const TURN = { hook: 1, elbow: -1, return: 3, wave: 0, zigzag: 2, loop: 0, straight: 0, crane: -2 }; // in 60° steps (game cw), mirrors DEFAULT_CATALOG
// Swamp ("water") half steps on doubled coordinates, mirroring src/sim/drug-graph/path.ts: the point
// P = 2·cell + offset; ties prefer the current cell, then the game's E,SE,SW,W,NW,NE order.
const dist2 = (pq, pr, q, r) => { const dq = pq - 2 * q, dr = pr - 2 * r; return dq * dq + dq * dr + dr * dr; };
function stamp(q, r, oq, or, h, m, relative, allowed) {
  let pq = 2 * q + oq, pr = 2 * r + or;
  for (const gd of CAT[m]) {
    const dir = G2L[(gd + (relative ? h : 0)) % 6];
    const scale = byKey.get(`${q},${r}`).kind === "water" ? 1 : 2;
    const nq = pq + DQ[dir] * scale, nr = pr + DR[dir] * scale;
    let tq = q, tr = r, best = dist2(nq, nr, q, r);
    for (let g = 0; g < 6; g++) { const d = G2L[g]; const cq = q + DQ[d], cr = r + DR[d]; const v = dist2(nq, nr, cq, cr); if (v < best) { best = v; tq = cq; tr = cr; } }
    const c = byKey.get(`${tq},${tr}`);
    if (!c || c.kind === "mountain" || !allowed(tq, tr)) continue;
    const moved = tq !== q || tr !== r; q = tq; r = tr;
    if (moved && c.kind !== "water") { pq = 2 * q; pr = 2 * r; } else { pq = nq; pr = nr; }
    if (c.kind === "black") return null;
  }
  return [q, r, pq - 2 * q, pr - 2 * r, relative ? (((h + TURN[m]) % 6) + 6) % 6 : 0];
}
const hexDist = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(aq + ar - bq - br));
function solvePass(ps, relative, machines) {
  const first = ps.path[0], last = ps.path.at(-1);
  const corridor = new Set(ps.cells.map(([q, r]) => `${q},${r}`));
  const inPocket = (q, r, end) => hexDist(q, r, end[0], end[1]) <= 2;
  const allowed = (q, r) => corridor.has(`${q},${r}`) || inPocket(q, r, first) || inPocket(q, r, last);
  const heads = relative ? [0, 1, 2, 3, 4, 5] : [0];
  const seen = new Set(); const queue = heads.map((h) => [first[0], first[1], 0, 0, h, []]);
  for (const s of queue) seen.add(s.slice(0, 5).join(","));
  while (queue.length) {
    const [q, r, oq, or, h, seq] = queue.shift(); if (seq.length >= 10) continue;
    for (const m of machines) { const nx = stamp(q, r, oq, or, h, m, relative, allowed); if (!nx) continue; const k = nx.join(","); if (seen.has(k)) continue; seen.add(k); const s2 = [...seq, m];
      if (inPocket(nx[0], nx[1], last)) return { ok: true, steps: s2.length, seq: s2.join("→") };
      queue.push([...nx, s2]); }
  }
  return { ok: false };
}
for (const ps of passes) {
  const rows = [["heading ignored, 4 basic", false, BASIC], ["heading-relative, 4 basic", true, BASIC], ["heading-relative, all 8", true, Object.keys(CAT)]].map(([label, rel, ms]) => { const s = solvePass(ps, rel, ms); return `${label}: ${s.ok ? `OK ${s.steps} steps (${s.seq})` : "NO SOLUTION ≤10"}`; });
  console.log(`${ps.name}: narrow ${ps.narrowCells.length} cells | ${rows.join(" | ")}`);
}
