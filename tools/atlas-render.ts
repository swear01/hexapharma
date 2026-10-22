/**
 * Dev-only Atlas preview of the real generator (never imported by the game).
 *
 *   npx tsx tools/atlas-render.ts [seed=14] [outDir=atlas-render-out]
 *
 * Writes `seed-N-full.png` (everything revealed: digits = disease, ★ = tier 2, black = failure,
 * purple dots = narrow pass core) and `seed-N-fog.png` (fresh fog: contours + start disk only),
 * using the same contour field as the Lab renderer.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { generateWithDiagnostics } from "../src/sim/mapgen/index";
import { CellKind, DEFAULT_CATALOG } from "../src/sim/phase0_interfaces";
import { hexDistance } from "../src/sim/hex";
import { CONTOUR_LEVELS, contourField } from "../src/render/labContours";

const seed = Number(process.argv[2] ?? 14);
const outDir = process.argv[3] ?? "atlas-render-out";
mkdirSync(outDir, { recursive: true });
const { level, diagnostics } = generateWithDiagnostics({
  seed,
  nMaps: 1,
  width: 49,
  height: 49,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 4,
  difficulty: { min: 4, max: 12 },
});
const map = level.mm.maps[0]!;
const S = 12.5;
const W = 1100;
const H = 1000;
const centre = { x: Math.sqrt(3) * S * (map.start.q + map.start.r / 2), y: 1.5 * S * map.start.r };
const ox = W / 2 - centre.x;
const oy = H / 2 - centre.y;
const STEP = 4;
const cols = Math.ceil(W / STEP) + 1;
const rows = Math.ceil(H / STEP) + 1;
const field: number[] = [];
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < cols; i++) field.push(contourField(map, i * STEP - ox, j * STEP - oy, S));
}
const radius = Math.floor((Math.min(map.width, map.height) - 1) / 2);
const cells = [];
for (let r = 0; r < map.height; r++) {
  for (let q = 0; q < map.width; q++) {
    if (hexDistance(q, r, map.start.q, map.start.r) > radius) continue;
    const index = r * map.width + q;
    cells.push({
      q,
      r,
      kind: map.cell[index]!,
      cure: map.cureId[index]!,
      tier: map.cureTier[index]!,
      side: map.sideEffectId[index]! >= 0,
    });
  }
}
const narrow = diagnostics.maps[0]!.passes.flatMap((pass) => pass.narrow).map((index) => [index % map.width, Math.floor(index / map.width)]);
const data = { cells, narrow, field, cols, rows, step: STEP, levels: CONTOUR_LEVELS, start: map.start, radius, ox, oy, S, kinds: CellKind };

const browser = await chromium.launch();
try {
  for (const mode of ["full", "fog"] as const) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<body style="margin:0;background:#f6f3ec"><canvas id=c width=${W} height=${H}></canvas></body>`);
    // tsx keeps function names via an injected __name helper the page does not have.
    await page.evaluate("globalThis.__name = (fn) => fn");
    await page.evaluate(({ data, mode }) => {
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const g = canvas.getContext("2d")!;
      const s = data.S;
      const S3 = Math.sqrt(3);
      const toPx = (q: number, r: number) => ({ x: data.ox + s * S3 * (q + r / 2), y: data.oy + s * 1.5 * r });
      const fog = mode === "fog";
      const hex = (x: number, y: number, rad: number) => {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 180 * (60 * k - 30);
          g.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
        }
        g.closePath();
      };
      const tint = ["#bfe3c4", "#cfe8b0", "#b8e0d2", "#d6e9c0", "#c4e6c9", "#d3ebb5", "#bde2d6", "#dbecc4"];
      for (const c of data.cells) {
        const { x, y } = toPx(c.q, c.r);
        const near = Math.max(Math.abs(c.q - data.start.q), Math.abs(c.r - data.start.r), Math.abs(c.q + c.r - data.start.q - data.start.r)) <= 2;
        const show = !fog || near;
        let fill = fog ? "#ece7db" : "#fffdf8";
        if (show) {
          if (c.kind === data.kinds.Wall) fill = "#cdb79a";
          else if (c.kind === data.kinds.Swamp) fill = "#cfe3f1";
          else if (c.kind === data.kinds.Abyss) fill = "#1e1f1c";
          else if (c.kind === data.kinds.Cure) fill = tint[c.cure % tint.length]!;
        }
        hex(x, y, s);
        g.fillStyle = fill;
        g.fill();
        if (show) {
          g.strokeStyle = "rgba(30,31,28,.08)";
          g.lineWidth = 1;
          g.stroke();
        }
      }
      const inside = (X: number, Y: number) => {
        const xx = (X - data.ox) / s;
        const yy = (Y - data.oy) / s;
        const r = yy / 1.5 - data.start.r;
        const q = xx / S3 - (yy / 1.5) / 2 - data.start.q;
        return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= data.radius + 0.5;
      };
      for (const L of data.levels) {
        g.strokeStyle = "rgba(120,96,70,.55)";
        g.lineWidth = 1.1;
        g.beginPath();
        for (let j = 0; j < data.rows - 1; j++) {
          for (let i = 0; i < data.cols - 1; i++) {
            const X = i * data.step;
            const Y = j * data.step;
            if (!inside(X, Y)) continue;
            const a = data.field[j * data.cols + i]!;
            const b = data.field[j * data.cols + i + 1]!;
            const c = data.field[(j + 1) * data.cols + i + 1]!;
            const d = data.field[(j + 1) * data.cols + i]!;
            const code = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const it = (v0: number, v1: number) => (L - v0) / (v1 - v0);
            const T = [X + data.step * it(a, b), Y];
            const Rr = [X + data.step, Y + data.step * it(b, c)];
            const B = [X + data.step * it(d, c), Y + data.step];
            const Lf = [X, Y + data.step * it(a, d)];
            const seg = (p1: number[], p2: number[]) => {
              g.moveTo(p1[0]!, p1[1]!);
              g.lineTo(p2[0]!, p2[1]!);
            };
            switch (code) {
              case 1: case 14: seg(Lf, T); break;
              case 2: case 13: seg(T, Rr); break;
              case 3: case 12: seg(Lf, Rr); break;
              case 4: case 11: seg(Rr, B); break;
              case 6: case 9: seg(T, B); break;
              case 7: case 8: seg(Lf, B); break;
              case 5: seg(Lf, T); seg(Rr, B); break;
              case 10: seg(T, Rr); seg(Lf, B); break;
            }
          }
        }
        g.stroke();
      }
      if (!fog) {
        for (const c of data.cells) {
          if (c.kind !== data.kinds.Cure) continue;
          const { x, y } = toPx(c.q, c.r);
          hex(x, y, s);
          g.strokeStyle = "#2f8f46";
          g.lineWidth = 1;
          g.stroke();
          g.fillStyle = c.tier === 2 ? "#1a6b30" : "#2f8f46";
          g.font = c.tier === 2 ? "bold 14px sans-serif" : "600 9px sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(c.tier === 2 ? "★" : String(c.cure + 1), x, y);
          if (c.side) {
            g.fillStyle = "#d9822b";
            g.beginPath();
            g.arc(x + 6, y - 6, 2.2, 0, 7);
            g.fill();
          }
        }
        for (const [q, r] of data.narrow) {
          const { x, y } = toPx(q!, r!);
          g.fillStyle = "rgba(123,44,191,.55)";
          g.beginPath();
          g.arc(x, y, 2.6, 0, 7);
          g.fill();
        }
      }
      const st = toPx(data.start.q, data.start.r);
      g.strokeStyle = "#7b2cbf";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(st.x, st.y - 9);
      g.lineTo(st.x + 8, st.y + 6);
      g.lineTo(st.x - 8, st.y + 6);
      g.closePath();
      g.stroke();
    }, { data, mode });
    await page.screenshot({ path: `${outDir}/seed-${seed}-${mode}.png` });
  }
} finally {
  await browser.close();
}
console.log(`wrote ${outDir}/seed-${seed}-full.png and -fog.png`);
