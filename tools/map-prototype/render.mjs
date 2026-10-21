import { R, cells, passes } from "./map.mjs";
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
// Usage: node tools/map-prototype/render.mjs [outDir]  (default: map-prototype-out/, gitignored)
const OUT_DIR = process.argv[2] ?? "map-prototype-out";
mkdirSync(OUT_DIR, { recursive: true });
const { cells: list, regions } = cells();
const byKey = new Map(list.map((c) => [c.key, c]));
const N = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const seen = new Set(["0,0"]); const stack = [[0, 0]];
while (stack.length) { const [q, r] = stack.pop(); for (const [dq, dr] of N) { const k = `${q+dq},${r+dr}`; const c = byKey.get(k); if (c && !seen.has(k) && c.kind !== "mountain" && c.kind !== "black") { seen.add(k); stack.push([q+dq, r+dr]); } } }
const walk = list.filter((c) => c.kind !== "mountain" && c.kind !== "black");
const unreachable = walk.filter((c) => !seen.has(c.key));
const eff = list.filter((c) => c.effect);
console.log(JSON.stringify({ cells: list.length, mountain: list.filter(c=>c.kind==="mountain").length, water: list.filter(c=>c.kind==="water").length, black: list.filter(c=>c.kind==="black").length, effectCells: eff.length, tier2: eff.filter(c=>c.effect.tier===2).length, unreachable: unreachable.length, regionsReach: regions.map(rg => `D${rg.d}:${rg.cells.filter(c=>seen.has(c.key)).length}/${rg.cells.length}${rg.stars?"★"+rg.stars:""}`) }));
const data = { list: list.map(({q,r,kind,effect,pass}) => ({q,r,kind,effect,pass})), narrow: passes.flatMap(p => p.narrowCells), R, unreachable: unreachable.map(c=>[c.q,c.r]) };
const b = await chromium.launch();
try {
for (const mode of ["full", "fog"]) {
  const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  await p.setContent(`<body style="margin:0;background:#f6f3ec"><canvas id=c width=1100 height=1000></canvas></body>`);
  await p.evaluate(({ data, mode }) => {
    const cv = globalThis.document.getElementById("c"), g = cv.getContext("2d");
    const s = 12.5, S3 = Math.sqrt(3), ox = 550, oy = 500;
    const toPx = (q, r) => ({ x: ox + s * S3 * (q + r / 2), y: oy + s * 1.5 * r });
    const fog = mode === "fog";
    const revealed = (q, r) => !fog || (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2);
    const hex = (x, y, rad) => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); g.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a)); } g.closePath(); };
    const DCOL = { 1: "#bfe3c4", 2: "#cfe8b0", 3: "#b8e0d2", 4: "#d6e9c0" };
    for (const c of data.list) {
      const { x, y } = toPx(c.q, c.r); const show = revealed(c.q, c.r);
      let fill = fog ? "#ece7db" : "#fffdf8";
      if (show) {
        if (c.kind === "mountain") fill = "#cdb79a"; else if (c.kind === "water") fill = "#cfe3f1"; else if (c.kind === "black") fill = "#1e1f1c";
        if (c.effect) fill = DCOL[c.effect.d];
      }
      hex(x, y, s); g.fillStyle = fill; g.fill();
      if (show) { g.strokeStyle = "rgba(30,31,28,.08)"; g.lineWidth = 1; g.stroke(); }
    }
    // contours: marching squares on a fine pixel grid using the hex-space elevation (passed via data.list interpolation is coarse) -> recompute analytically
    const E = new Function(data.elevSrc)();
    const step = 4, W = cv.width, Hh = cv.height, cols = Math.ceil(W / step) + 1, rows = Math.ceil(Hh / step) + 1;
    const grid = new Float32Array(cols * rows);
    const inMap = (X, Y) => { const xx = (X - ox) / s, yy = (Y - oy) / s; const r = yy / 1.5, q = xx / S3 - r / 2; return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= data.R + 0.5; };
    const decoy = (x, y) => 0.22 * Math.sin(x * 0.42 + 0.7) * Math.sin(y * 0.37 - 1.1) + 0.14 * Math.sin((x + 2 * y) * 0.29 + 2.3);
    const F = (x, y) => { const e = E(x, y); return (1 - Math.exp(-1.25 * Math.abs(e))) + decoy(x, y); };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = F((i * step - ox) / s, (j * step - oy) / s);
    const levels = [0.16, 0.34, 0.52, 0.7, 0.88];
    for (const L of levels) {
      g.strokeStyle = "rgba(120,96,70,.55)"; g.lineWidth = 1.1;
      g.beginPath();
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const X = i * step, Y = j * step; if (!inMap(X, Y)) continue;
        const a = grid[j*cols+i], b2 = grid[j*cols+i+1], c2 = grid[(j+1)*cols+i+1], d = grid[(j+1)*cols+i];
        const code = (a > L ? 1 : 0) | (b2 > L ? 2 : 0) | (c2 > L ? 4 : 0) | (d > L ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const it = (v0, v1) => (L - v0) / (v1 - v0);
        const T = [X + step * it(a, b2), Y], Rr = [X + step, Y + step * it(b2, c2)], B = [X + step * it(d, c2), Y + step], Lf = [X, Y + step * it(a, d)];
        const seg = (p1, p2) => { g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); };
        switch (code) { case 1: case 14: seg(Lf, T); break; case 2: case 13: seg(T, Rr); break; case 3: case 12: seg(Lf, Rr); break; case 4: case 11: seg(Rr, B); break; case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, B); break; case 5: seg(Lf, T); seg(Rr, B); break; case 10: seg(T, Rr); seg(Lf, B); break; }
      }
      g.stroke();
    }
    // overlays (full view only): mountains hatch, cure stars, unreachable marks
    if (!fog) {
      for (const c of data.list) if (c.effect) { const { x, y } = toPx(c.q, c.r); hex(x, y, s); g.strokeStyle = "#2f8f46"; g.lineWidth = 1; g.stroke();
        g.fillStyle = c.effect.tier === 2 ? "#1a6b30" : "#2f8f46"; g.font = c.effect.tier === 2 ? "bold 14px sans-serif" : "600 9px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(c.effect.tier === 2 ? "★" : String(c.effect.d), x, y); }
      for (const [q, r] of data.narrow) { const { x, y } = toPx(q, r); g.fillStyle = "rgba(123,44,191,.55)"; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
      for (const [q, r] of data.unreachable) { const { x, y } = toPx(q, r); g.strokeStyle = "#e00"; g.lineWidth = 2; g.beginPath(); g.moveTo(x-4,y-4); g.lineTo(x+4,y+4); g.moveTo(x+4,y-4); g.lineTo(x-4,y+4); g.stroke(); }
    }
    const st = toPx(0, 0); g.strokeStyle = "#7b2cbf"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(st.x, st.y - 9); g.lineTo(st.x + 8, st.y + 6); g.lineTo(st.x - 8, st.y + 6); g.closePath(); g.stroke();
    g.fillStyle = "#1e1f1c"; g.font = "600 16px sans-serif"; g.textAlign = "left"; g.fillText(fog ? "Fog view v6: one ink, sign-free compressed relief + decoys" : "Prototype v6 — full reveal (digits = disease, ★ = tier 2, black = failure, purple dots = narrow pass)", 16, 24);
  }, { data: { ...data, elevSrc: `${elevSrcBody()}` }, mode });
  await p.screenshot({ path: `${OUT_DIR}/${mode}.png` });
}
} finally {
  await b.close();
}
function elevSrcBody() {
  // Ship map.mjs's relief code (from the DQ table up to MOUNTAIN) to the page so contours sample the same field.
  const src = readFileSync(new URL("./map.mjs", import.meta.url), "utf8");
  const relief = src.slice(src.indexOf("export const DQ"), src.indexOf("export const MOUNTAIN")).replace(/\bexport /g, "");
  return `const S3 = Math.sqrt(3); const px = (q, r) => ({ x: S3 * (q + r / 2), y: 1.5 * r }); const R = ${R};\n${relief}\nreturn elevation;`;
}
