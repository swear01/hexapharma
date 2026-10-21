// HexaPharma prototype map v4: zones, ranges with long narrow passes, tiered effect regions, failure (black) cells.
export const R = 24;
const S3 = Math.sqrt(3);
export const px = (q, r) => ({ x: S3 * (q + r / 2), y: 1.5 * r });
export const DQ = [1, 1, 0, -1, -1, 0], DR = [0, -1, -1, 0, 1, 1]; // E, NE, NW, W, SW, SE (ccw)
const g = (d, w) => Math.exp(-(d / w) * (d / w));
const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const lineDist = (p, pts) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i])); return d; };
const arc = (cx, cy, rho, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return { x: cx + rho * Math.cos(a), y: cy + rho * Math.sin(a) }; });
const inMap = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= R;
const cellAtAngle = (rhoCells, deg) => { const a = deg * Math.PI / 180; const x = rhoCells * S3 * Math.cos(a), y = rhoCells * S3 * Math.sin(a); const r = Math.round(y / 1.5); const q = Math.round(x / S3 - r / 2); return [q, r]; };
const hash = (q, r, k) => { let h = Math.imul(q * 73856093 ^ r * 19349663 ^ k * 83492791, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function dijkstra(from, to, k) {
  const key = (q, r) => `${q},${r}`; const dist = new Map([[key(...from), 0]]); const prev = new Map(); const open = [[0, from]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); const [d, [q, r]] = open.shift(); if (q === to[0] && r === to[1]) break;
    if (d > (dist.get(key(q, r)) ?? 1e9)) continue;
    for (let n = 0; n < 6; n++) { const nq = q + DQ[n], nr = r + DR[n]; if (!inMap(nq, nr)) continue;
      const nd = d + 1 + 5 * hash(nq, nr, k); if (nd < (dist.get(key(nq, nr)) ?? 1e9)) { dist.set(key(nq, nr), nd); prev.set(key(nq, nr), [q, r]); open.push([nd, [nq, nr]]); } }
  }
  const path = [to]; let cur = to; while (cur[0] !== from[0] || cur[1] !== from[1]) { cur = prev.get(key(...cur)); path.push(cur); } return path.reverse();
}
const route = (pts, k) => pts.slice(1).reduce((acc, p, i) => [...acc, ...dijkstra(pts[i], p, k + i).slice(1)], [pts[0]]);
const polar = cellAtAngle;
// ---- relief ----
const RING = 9;
const ranges = [
  { h: 1.5, w: 2.9, pts: arc(0, 0, RING * S3, 0, 360, 48) },     // inner ring range (thick)
  { h: 1.4, w: 2.4, pts: arc(0, 0, 18.5 * S3, 195, 262, 16) },   // outer NW arc
  { h: 1.4, w: 2.4, pts: arc(0, 0, 18.5 * S3, 92, 152, 16) },    // outer S arc
  { h: 1.25, w: 2.0, pts: [px(12, 2), px(16, 0), px(21, -2)] },  // east spur
];
const craters = [
  { c: px(9, -17), rho: 7.6, h: 1.7, w: 2.1, floor: -0.12 },   // NE basin
  { c: px(-16, 18), rho: 6.8, h: 1.65, w: 2.0, floor: -0.1 },  // SW basin
];
const lakes = [
  { c: px(-3, -2), h: 1.0, w: 2.4 },
  { c: px(12, 6), h: 1.0, w: 3.6 }, { c: px(15, 5), h: 0.8, w: 2.4 },
  { c: px(-15, 4), h: 0.95, w: 3.0 },
];
// passes: [waypoints], seed, narrow fraction window -> wide (2-3) at ends, long 1-wide narrow core
const passSpecs = [
  { name: "Ring NE", pts: [polar(RING - 5, -40), polar(RING - 1, -22), polar(RING + 1, -48), polar(RING + 5, -32)], k: 11, narrow: [0.3, 0.75] },
  { name: "Ring S", pts: [polar(RING - 5, 100), polar(RING, 122), polar(RING + 5, 98)], k: 23, narrow: [0.3, 0.75] },
  { name: "Ring W", pts: [polar(RING - 5, 205), polar(RING - 1, 185), polar(RING + 1, 222), polar(RING + 5, 200)], k: 37, narrow: [0.3, 0.75] },
  { name: "NE basin", pts: [[11, -6], [14, -10], [12, -13], [9, -16]], k: 41, narrow: [0.25, 0.8] },
  { name: "SW basin", pts: [[-7, 19], [-10, 22], [-13, 19], [-16, 18]], k: 53, narrow: [0.25, 0.8] },
];
export const passes = passSpecs.map((s) => {
  const path = route(s.pts, s.k); const n = path.length; const a = Math.floor(n * s.narrow[0]), b = Math.ceil(n * s.narrow[1]);
  const open = new Map(path.map(([q, r]) => [`${q},${r}`, [q, r]]));
  path.forEach(([q, r], i) => { if (i >= a && i <= b) return; for (let d = 0; d < 6; d += (i % 2 ? 2 : 3)) { const nq = q + DQ[d], nr = r + DR[d]; if (inMap(nq, nr)) open.set(`${nq},${nr}`, [nq, nr]); } });
  return { name: s.name, path, narrowCells: path.slice(a, b + 1), cells: [...open.values()] };
});
const passCells = new Set(passes.flatMap((p) => p.cells.map(([q, r]) => `${q},${r}`)));
const passPts = passes.map((p) => p.path.map(([q, r]) => px(q, r)));
export function elevation(x, y, carved = true) {
  const p = { x, y };
  let e = 0.16 * Math.sin(x * 0.19 + 1.3) * Math.cos(y * 0.15 - 0.4) + 0.08 * Math.sin((x - y) * 0.31 + 0.7);
  for (const rg of ranges) e += rg.h * g(lineDist(p, rg.pts), rg.w);
  for (const cr of craters) { const d = Math.hypot(x - cr.c.x, y - cr.c.y); e += cr.h * g(d - cr.rho, cr.w); if (d < cr.rho - 1.5) e += cr.floor; }
  for (const lk of lakes) e -= lk.h * g(Math.hypot(x - lk.c.x, y - lk.c.y), lk.w);
  { const r = y / 1.5, q = x / S3 - r / 2; const edge = R - Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); if (edge < 1.6) e += 1.4 * g(edge, 0.75); }
  if (!carved) return e;
  let carve = 0; for (const pts of passPts) carve = Math.max(carve, g(lineDist(p, pts), 1.0));
  if (e > 0.3) e -= (e - 0.3) * carve;
  return e;
}
export const MOUNTAIN = 0.6, WATER = -0.45;
// ---- effects: grow regions from seeds over plain cells; tier-2 (★) core in hard areas ----
export const regionSpecs = [
  // easy (inner / middle zone): 3–5 cells, tier-1 only
  { d: 1, seed: [4, -3], size: 5, stars: 0 }, { d: 2, seed: [-5, 4], size: 4, stars: 0 }, { d: 3, seed: [2, 4], size: 3, stars: 0 },
  { d: 1, seed: [-13, -2], size: 4, stars: 0 }, { d: 4, seed: [14, 1], size: 5, stars: 0 }, { d: 2, seed: [6, 15], size: 4, stars: 0 },
  // hard (basins / behind long passes): 9–12 cells with a ★ core
  { d: 3, seed: [9, -17], size: 12, stars: 3 }, { d: 4, seed: [-16, 18], size: 10, stars: 2 },
  { d: 1, seed: [-8, -14], size: 9, stars: 2 },   // behind the outer NW arc
  { d: 2, seed: [20, -9], size: 9, stars: 2 },    // far east, past the spur
];
export function cells() {
  const out = new Map();
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
    const { x, y } = px(q, r); const e = elevation(x, y, false); const key = `${q},${r}`;
    let kind = e > MOUNTAIN ? "mountain" : e < WATER ? "water" : "plain";
    if (passCells.has(key)) kind = "plain";
    out.set(key, { q, r, e: elevation(x, y), kind, key, pass: passCells.has(key) });
  }
  const at = (q, r) => out.get(`${q},${r}`);
  // cleanup: walkable cells not connected to the start become mountain (no sealed pockets)
  { const seen = new Set(["0,0"]); const st = [[0, 0]]; while (st.length) { const [q, r] = st.pop(); for (let d = 0; d < 6; d++) { const n = at(q + DQ[d], r + DR[d]); if (n && !seen.has(n.key) && n.kind !== "mountain") { seen.add(n.key); st.push([n.q, n.r]); } } }
    for (const c of out.values()) if (c.kind !== "mountain" && !seen.has(c.key)) c.kind = "mountain"; }
  // effect regions (BFS by hash order) on plain cells
  const regions = regionSpecs.map((s, idx) => {
    let seed = s.seed; { const q0 = [s.seed]; const vis = new Set(); while (q0.length) { const [q, r] = q0.shift(); const c = at(q, r); if (!c || vis.has(`${q},${r}`)) continue; vis.add(`${q},${r}`); if (c.kind === "plain" && !c.pass && !c.effect) { seed = [q, r]; break; } for (let d = 0; d < 6; d++) q0.push([q + DQ[d], r + DR[d]]); } }
    const got = []; const seen = new Set(); const frontier = [seed];
    while (frontier.length && got.length < s.size) {
      frontier.sort((a, b) => hash(a[0], a[1], idx) - hash(b[0], b[1], idx)); const [q, r] = frontier.shift(); const c = at(q, r);
      if (!c || seen.has(c.key) || c.kind !== "plain" || c.effect) continue; seen.add(c.key); got.push(c);
      for (let d = 0; d < 6; d++) frontier.push([q + DQ[d], r + DR[d]]);
    }
    got.forEach((c, i) => { c.effect = { d: s.d, tier: i < s.stars ? 2 : 1 }; });
    return { ...s, cells: got };
  });
  // failure (black) cells: (1) toxic pockets beside hard regions, (2) overshoot traps just past narrow pass exits, (3) a valley field
  const black = new Set();
  const mark = (q, r) => { const c = at(q, r); if (c && c.kind === "plain" && !c.effect && !c.pass && Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 3) { c.kind = "black"; black.add(c.key); } };
  for (const rg of regions.filter((x) => x.stars > 0)) {
    const ring = new Set(); for (const c of rg.cells) for (let d = 0; d < 6; d++) { const n = at(c.q + DQ[d], c.r + DR[d]); if (n && !n.effect && n.kind === "plain") ring.add(n.key); }
    [...ring].sort((a, b) => hash(...a.split(",").map(Number), 7) - hash(...b.split(",").map(Number), 7)).slice(0, 4).forEach((k) => mark(...k.split(",").map(Number)));
  }
  for (const ps of passes) { const end = ps.narrowCells.at(-1); const prev = ps.narrowCells.at(-2); const dq = end[0] - prev[0], dr = end[1] - prev[1];
    // a trap two cells past the narrow exit, offset sideways so a straight overshoot is punished but a careful exit is free
    const d = DQ.findIndex((x, i) => x === dq && DR[i] === dr); const side = (d + 1) % 6; mark(end[0] + 2 * dq + DQ[side], end[1] + 2 * dr + DR[side]); }
  for (const [q, r] of [[-1, 12], [0, 12], [1, 11], [-2, 13], [7, -8], [8, -8], [-10, 8], [-11, 9], [18, -14], [19, -15]]) mark(q, r);
  // -- fill voids: plain cells far from any effect/feature get an easy tier-1 region (largest void first)
  const featureDist = () => { const dist = new Map(); const qd = []; for (const c of out.values()) if (c.effect || c.kind !== "plain" || c.pass) { dist.set(c.key, 0); qd.push(c); }
    for (let i = 0; i < qd.length; i++) { const c = qd[i]; for (let d = 0; d < 6; d++) { const n = at(c.q + DQ[d], c.r + DR[d]); if (n && !dist.has(n.key)) { dist.set(n.key, dist.get(c.key) + 1); qd.push(n); } } } return dist; };
  const extra = [];
  for (let guard = 0; guard < 8; guard++) {
    const dist = featureDist(); let best = null; for (const c of out.values()) { const d = dist.get(c.key) ?? 0; if (Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) <= 3) continue; if (!best || d > best.d) best = { c, d }; }
    if (!best || best.d < 4) break;
    const dz = 1 + (extra.length + 1) % 4; const size = 3 + (hash(best.c.q, best.c.r, 99) * 3 | 0);
    const got = []; const fr = [[best.c.q, best.c.r]]; const vis = new Set();
    while (fr.length && got.length < size) { fr.sort((a2, b2) => hash(a2[0], a2[1], 5) - hash(b2[0], b2[1], 5)); const [q, r] = fr.shift(); const c = at(q, r); if (!c || vis.has(c.key) || c.kind !== "plain" || c.effect || c.pass) continue; vis.add(c.key); got.push(c); for (let d = 0; d < 6; d++) fr.push([q + DQ[d], r + DR[d]]); }
    got.forEach((c) => { c.effect = { d: dz, tier: 1 }; }); extra.push({ d: dz, size: got.length, stars: 0, cells: got, filler: true });
  }
  regions.push(...extra);
  // -- sneaky failure cells on ordinary ground (singles + ~5-cell strips), never on passes/effects, keep connectivity
  const connected = () => { const seen = new Set(["0,0"]); const st = [[0, 0]]; while (st.length) { const [q, r] = st.pop(); for (let d = 0; d < 6; d++) { const n = at(q + DQ[d], r + DR[d]); if (n && !seen.has(n.key) && n.kind !== "mountain" && n.kind !== "black") { seen.add(n.key); st.push([n.q, n.r]); } } }
    for (const c of out.values()) if (c.kind !== "mountain" && c.kind !== "black" && !seen.has(c.key)) return false; return true; };
  const tryMark = (q, r) => { const c = at(q, r); if (!c || c.kind !== "plain" || c.effect || c.pass || Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 4) return false; c.kind = "black"; if (!connected()) { c.kind = "plain"; return false; } black.add(c.key); return true; };
  const plains = [...out.values()].filter((c) => c.kind === "plain" && !c.effect && !c.pass).sort((a2, b2) => hash(a2.q, a2.r, 313) - hash(b2.q, b2.r, 313));
  let singles = 0; for (const c of plains) { if (singles >= 10) break; if (tryMark(c.q, c.r)) singles++; }
  let strips = 0; const usedSector = new Set(); for (const c of plains.slice(40)) { if (strips >= 3) break; const sector = Math.floor(((Math.atan2(px(c.q, c.r).y, px(c.q, c.r).x) / Math.PI + 1) * 3)) % 6; if (usedSector.has(sector) || Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) < 8) continue; const dir = (hash(c.q, c.r, 71) * 6) | 0; let q = c.q, r = c.r, n = 0; const placed = [];
    for (let i = 0; i < 5; i++) { if (tryMark(q, r)) { n++; placed.push([q, r]); } const bend = hash(q, r, 72) < 0.25 ? 1 : 0; const d2 = (dir + bend) % 6; q += DQ[d2]; r += DR[d2]; }
    if (n >= 4) { strips++; usedSector.add(sector); } else for (const [pq, pr] of placed) { const pc = at(pq, pr); pc.kind = "plain"; black.delete(pc.key); } }
  return { cells: [...out.values()], regions, black };
}
