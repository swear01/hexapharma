// Narrow-pass solvability: BFS over machine stamps (current absolute rules, and tentative heading-relative rules).
import { cells, passes, DQ, DR } from "./map.mjs";
const { cells: list } = cells(); const byKey = new Map(list.map((c) => [c.key, c]));
// catalog paths in the game's E,SE,SW,W,NW,NE order -> convert to this file's ccw order (E,NE,NW,W,SW,SE)
const G2L = [0, 5, 4, 3, 2, 1];
const CAT = { push: [0, 0, 1], push2: [0, 5, 0, 1, 0, 1, 0], pull: [3, 3, 4], shear: [4, 4, 5, 1], skew: [1, 0, 2, 3, 1, 5], dilute: [0, 1, 2, 3, 4, 5, 0, 1], settle: [1, 1, 0, 0, 4, 4, 5, 3, 2] };
const BASIC = ["push", "push2", "pull", "shear"];
const TURN = { push: 1, push2: 0, pull: 3, shear: -1, skew: 2, dilute: 0, settle: -2 }; // tentative, in 60° steps (game cw)
function stamp(q, r, h, m, relative, allowed) {
  let energy = CAT[m].length;
  for (const gd of CAT[m]) {
    const dir = G2L[(gd + (relative ? h : 0)) % 6]; const nq = q + DQ[dir], nr = r + DR[dir]; const c = byKey.get(`${nq},${nr}`);
    if (!c || c.kind === "mountain" || !allowed(nq, nr)) continue;
    const cost = c.kind === "water" ? 2 : 1; if (energy < cost) break; energy -= cost; q = nq; r = nr;
    if (c.kind === "black") return null;
  }
  return [q, r, relative ? (((h + TURN[m]) % 6) + 6) % 6 : 0];
}
// Only the pass corridor (plus a 2-cell pocket at each end) is walkable here, so a solution must thread the
// narrow core instead of bypassing it elsewhere on the map.
const hexDist = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(aq + ar - bq - br));
function solvePass(ps, relative, machines) {
  const first = ps.path[0], last = ps.path.at(-1);
  const corridor = new Set(ps.cells.map(([q, r]) => `${q},${r}`));
  const inPocket = (q, r, end) => hexDist(q, r, end[0], end[1]) <= 2;
  const allowed = (q, r) => corridor.has(`${q},${r}`) || inPocket(q, r, first) || inPocket(q, r, last);
  const heads = relative ? [0, 1, 2, 3, 4, 5] : [0];
  const seen = new Set(); const queue = heads.map((h) => [first[0], first[1], h, []]);
  for (const s of queue) seen.add(s.slice(0, 3).join(","));
  while (queue.length) {
    const [q, r, h, seq] = queue.shift(); if (seq.length >= 10) continue;
    for (const m of machines) { const nx = stamp(q, r, h, m, relative, allowed); if (!nx) continue; const k = nx.join(","); if (seen.has(k)) continue; seen.add(k); const s2 = [...seq, m];
      if (inPocket(nx[0], nx[1], last)) return { ok: true, steps: s2.length, seq: s2.join("→") };
      queue.push([...nx, s2]); }
  }
  return { ok: false };
}
for (const ps of passes) {
  const rows = [["absolute, 4 basic", false, BASIC], ["heading-relative, 4 basic", true, BASIC], ["heading-relative, all 7", true, Object.keys(CAT)]].map(([label, rel, ms]) => { const s = solvePass(ps, rel, ms); return `${label}: ${s.ok ? `OK ${s.steps} steps (${s.seq})` : "NO SOLUTION ≤10"}`; });
  console.log(`${ps.name}: narrow ${ps.narrowCells.length} cells | ${rows.join(" | ")}`);
}
