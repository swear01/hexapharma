import { expect, test, type Locator, type Page } from "@playwright/test";
import { LAB_CELL_PIXELS, LAB_VIEWPORT, focusLabCamera, visibleLabCells } from "../../src/render/labCamera";
import { labTerrainVisual, type LabTerrainVisual } from "../../src/render/labTerrain";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { CellKind, DEFAULT_CATALOG, type Template, type Vec2 } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

const REGION_SEED = 14;
const START_CELL = { x: 31, y: 31 } as const;
const REGION_FOCUS = { x: 8, y: 8 } as const;

test.setTimeout(60_000);

function fixtureRegionCounts(): Readonly<Record<number, number>> {
  const map = generate(defaultGenOptions(REGION_SEED)).mm.maps[0]!;
  const bounds = visibleLabCells(focusLabCamera(REGION_FOCUS), LAB_VIEWPORT, map);
  const counts: Record<number, number> = {};
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const kind = map.cell[y * map.width + x]!;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

async function panFromStartToRegion(page: Page, frame: Locator): Promise<void> {
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Lab frame has no bounding box");
  const dragX = -(REGION_FOCUS.x - START_CELL.x) * LAB_CELL_PIXELS * box.width / LAB_VIEWPORT.width;
  const dragY = -(REGION_FOCUS.y - START_CELL.y) * LAB_CELL_PIXELS * box.height / LAB_VIEWPORT.height;
  const horizontalStartX = box.x + box.width * 0.48;
  const horizontalY = box.y + box.height * 0.82;
  for (let part = 0; part < 3; part++) {
    await page.mouse.move(horizontalStartX, horizontalY);
    await page.mouse.down();
    await page.mouse.move(horizontalStartX + dragX / 3, horizontalY, { steps: 6 });
    await page.mouse.up();
  }
  const verticalX = box.x + box.width * 0.3;
  const verticalStartY = box.y + box.height * 0.4;
  await page.mouse.move(verticalX, verticalStartY);
  await page.mouse.down();
  await page.mouse.move(verticalX, verticalStartY + dragY, { steps: 6 });
  await page.mouse.up();
}

function terrainResearchFixture(): {
  readonly save: string;
  readonly targets: Readonly<Record<number, Vec2>>;
  readonly visuals: readonly LabTerrainVisual[];
} {
  const options = defaultGenOptions(15);
  const level = generate(options);
  let game = createGameState(options, 1_000_000, 0);
  for (const typeId of ["push", "push2", "pull", "shear"]) {
    const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId)!;
    const program: Template = {
      steps: Array.from({ length: 5 }, () => ({
        typeId: entry.typeId,
        path: entry.path,
        stroke: entry.path.length,
      })),
    };
    game = applyGameIntent(game, { kind: "setResearchProgram", program });
    game = applyGameIntent(game, { kind: "beginResearchShot" });
    while (game.research.shot !== null) {
      game = applyGameIntent(game, { kind: "advanceResearchShot" });
    }
  }
  const map = level.mm.maps[0]!;
  const targets: Record<number, Vec2> = {};
  for (const kind of [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal]) {
    let best: Vec2 | null = null;
    let bestRadius = Number.POSITIVE_INFINITY;
    for (let index = 0; index < map.cell.length; index++) {
      if (map.cell[index] !== kind || game.fog[0]![index] !== 1) continue;
      const point = { x: index % map.width, y: Math.floor(index / map.width) };
      const radius = Math.max(Math.abs(point.x - map.start.x), Math.abs(point.y - map.start.y));
      if (radius < bestRadius) {
        best = point;
        bestRadius = radius;
      }
    }
    if (best === null) throw new Error(`seed 15 did not reveal terrain kind ${kind}`);
    targets[kind] = best;
  }
  const revealedMap = { ...map, fog: game.fog[0]! };
  const visuals = [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal].map((kind) => {
    const target = targets[kind]!;
    return labTerrainVisual(revealedMap, target.x, target.y);
  });
  return { save: serializeGame(game), targets, visuals };
}

test("fogged terrain regions pan over the large grid without a reveal-all bypass", async ({
  page,
}) => {
  const counts = fixtureRegionCounts();
  for (const kind of [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal]) {
    expect(counts[kind], `seed ${REGION_SEED} viewport must contain cell kind ${kind}`).toBeGreaterThan(0);
  }

  const map = generate(defaultGenOptions(REGION_SEED)).mm.maps[0]!;
  const portal = map.cell.findIndex((kind) => kind === CellKind.Portal);
  expect(portal).toBeGreaterThanOrEqual(0);
  expect(map.portalTo[portal]).toBeGreaterThanOrEqual(0);
  expect(map.portalTo[portal]).toBeLessThan(map.width * map.height);

  await page.goto(`/?seed=${REGION_SEED}`);
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await panFromStartToRegion(page, frame);
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
  await expect(page.getByTestId("reveal")).toHaveCount(0);
});

test("actual Dispenses expose distinct Wall, Abyss, Swamp, and Portal renderer motifs", async ({
  page,
}) => {
  const fixture = terrainResearchFixture();
  expect(fixture.visuals.map((visual) => visual.kind)).toEqual([
    "wall",
    "abyss",
    "swamp",
    "portal",
  ]);
  const motifs = fixture.visuals.map((visual) => {
    if (!("motif" in visual)) throw new Error("an actually revealed terrain motif remained fogged");
    return visual.motif;
  });
  expect(new Set(motifs).size).toBe(4);
  expect(new Set(fixture.visuals.map((visual) => "baseColor" in visual ? visual.baseColor : -1)).size)
    .toBe(4);
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), fixture.save);
  await page.reload();
  await page.getByTestId("load").click();
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-render-error")).toHaveCount(0);
});
