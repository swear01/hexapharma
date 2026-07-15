import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  LAB_CELL_PIXELS,
  LAB_VIEWPORT,
  clampLabCamera,
  focusLabCamera,
  visibleLabCells,
} from "../../src/render/labCamera";
import { labTerrainVisual, type LabTerrainVisual } from "../../src/render/labTerrain";
import { createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { CellKind, type Vec2 } from "../../src/sim/phase0_interfaces";
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

async function panFromStartToRegion(
  page: Page,
  frame: Locator,
  target: Vec2 = REGION_FOCUS,
): Promise<void> {
  const box = await frame.boundingBox();
  const viewportBox = await frame.getByTestId("lab-canvas").boundingBox();
  if (box === null || viewportBox === null) throw new Error("Lab frame has no bounding box");
  const dragX = -(target.x - START_CELL.x) * LAB_CELL_PIXELS * viewportBox.width / LAB_VIEWPORT.width;
  const dragY = -(target.y - START_CELL.y) * LAB_CELL_PIXELS * viewportBox.height / LAB_VIEWPORT.height;
  const horizontalStartX = box.x + box.width * 0.48;
  const horizontalY = box.y + box.height * 0.82;
  for (let part = 0; part < 3; part++) {
    await page.mouse.move(horizontalStartX, horizontalY);
    await page.mouse.down();
    await page.mouse.move(horizontalStartX + dragX / 3, horizontalY);
    await page.mouse.up();
  }
  const verticalX = box.x + box.width * 0.3;
  const verticalStartY = box.y + box.height * 0.4;
  for (let part = 0; part < 3; part++) {
    await page.mouse.move(verticalX, verticalStartY);
    await page.mouse.down();
    await page.mouse.move(verticalX, verticalStartY + dragY / 3);
    await page.mouse.up();
  }
  const expected = clampLabCamera(focusLabCamera(target), LAB_VIEWPORT, { width: 63, height: 63 });
  await expect.poll(async () => Number(await frame.getAttribute("data-camera-x")))
    .toBeCloseTo(expected.x, 5);
  await expect.poll(async () => Number(await frame.getAttribute("data-camera-y")))
    .toBeCloseTo(expected.y, 5);
}

async function patchDifference(
  page: Page,
  first: Buffer,
  second: Buffer,
  offset: Vec2 = { x: 0, y: 0 },
): Promise<number> {
  return page.evaluate(async ({ firstImage, secondImage, cellOffset, cellPixels, viewportWidth }) => {
    const decode = async (source: string): Promise<HTMLCanvasElement> => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("Lab screenshot decode has no 2D context");
      context.drawImage(image, 0, 0);
      return canvas;
    };
    const firstCanvas = await decode(firstImage);
    const secondCanvas = await decode(secondImage);
    if (
      firstCanvas.width !== secondCanvas.width ||
      firstCanvas.height !== secondCanvas.height
    ) {
      throw new Error("Lab screenshot dimensions changed between discovery states");
    }
    const firstContext = firstCanvas.getContext("2d");
    const secondContext = secondCanvas.getContext("2d");
    if (firstContext === null || secondContext === null) {
      throw new Error("Lab screenshot comparison has no 2D context");
    }
    const cell = cellPixels * firstCanvas.width / viewportWidth;
    const size = Math.max(4, Math.floor(cell * 0.36));
    const x = Math.floor((firstCanvas.width - size) / 2 + cellOffset.x * cell);
    const y = Math.floor((firstCanvas.height - size) / 2 + cellOffset.y * cell);
    const a = firstContext.getImageData(x, y, size, size).data;
    const b = secondContext.getImageData(x, y, size, size).data;
    let difference = 0;
    for (let index = 0; index < a.length; index += 4) {
      difference += Math.abs(a[index]! - b[index]!);
      difference += Math.abs(a[index + 1]! - b[index + 1]!);
      difference += Math.abs(a[index + 2]! - b[index + 2]!);
    }
    return difference / (a.length / 4 * 3);
  }, {
    firstImage: first.toString("base64"),
    secondImage: second.toString("base64"),
    cellOffset: offset,
    cellPixels: LAB_CELL_PIXELS,
    viewportWidth: LAB_VIEWPORT.width,
  });
}

async function syntheticRendererScreenshot(
  page: Page,
  discovered: boolean,
  centerKind: CellKind = CellKind.Wall,
): Promise<Buffer> {
  await page.goto("/assets/lab/manifest.json");
  await page.evaluate(async ({ fogValue, renderedKind, cureKind, sideEffectKind }) => {
    document.body.innerHTML = '<div id="lab-renderer-smoke"></div>';
    document.body.style.margin = "0";
    const moduleUrl = "/src/render/labRenderer.ts";
    const { createLabRenderer } = await import(moduleUrl);
    const width = 21;
    const height = 13;
    const length = width * height;
    const cell = new Uint8Array(length);
    const center = 6 * width + 10;
    cell[center] = renderedKind;
    const fog = new Uint8Array(length);
    fog.fill(fogValue);
    const cureId = new Int16Array(length).fill(-1);
    const sideEffectId = new Int32Array(length).fill(-1);
    if (renderedKind === cureKind) cureId[center] = 0;
    if (renderedKind === sideEffectKind) sideEffectId[center] = 100;
    const map = {
      width,
      height,
      origin: { x: 10, y: 6 },
      start: { x: 10, y: 6 },
      cell,
      cureId,
      sideEffectId,
      portalTo: new Int32Array(length).fill(-1),
      fog,
    };
    const mm = { maps: [map] };
    const renderer = await createLabRenderer(mm);
    document.querySelector("#lab-renderer-smoke")!.append(renderer.canvas);
    renderer.render(mm, { pos: [{ x: 0, y: 0 }], failed: false }, {
      activeMap: 0,
      camera: { x: 10.5, y: 6.5, zoom: 1 },
      trail: [],
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, {
    fogValue: discovered ? 1 : 0,
    renderedKind: centerKind,
    cureKind: CellKind.Cure,
    sideEffectKind: CellKind.SideEffect,
  });
  const canvas = page.locator("#lab-renderer-smoke canvas");
  await expect(canvas).toBeVisible();
  return canvas.screenshot({ animations: "disabled" });
}

function terrainResearchFixture(): {
  readonly save: string;
  readonly targets: Readonly<Record<number, Vec2>>;
  readonly visuals: readonly LabTerrainVisual[];
} {
  const options = defaultGenOptions(15);
  const level = generate(options);
  const game = createGameState(options, 1_000_000, 0);
  const map = level.mm.maps[0]!;
  const targets: Record<number, Vec2> = {};
  for (const kind of [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal]) {
    let best: Vec2 | null = null;
    let bestRadius = Number.POSITIVE_INFINITY;
    for (let index = 0; index < map.cell.length; index++) {
      if (map.cell[index] !== kind) continue;
      const point = { x: index % map.width, y: Math.floor(index / map.width) };
      const radius = Math.max(Math.abs(point.x - map.start.x), Math.abs(point.y - map.start.y));
      if (radius < bestRadius) {
        best = point;
        bestRadius = radius;
      }
    }
    if (best === null) throw new Error(`seed 15 did not generate terrain kind ${kind}`);
    targets[kind] = best;
  }
  const initialMap = { ...map, fog: game.fog[0]! };
  const visuals = [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal].map((kind) => {
    const target = targets[kind]!;
    return labTerrainVisual(initialMap, target.x, target.y);
  });
  return { save: serializeGame(game), targets, visuals };
}

test("structural terrain regions pan over the large grid without a reveal-all bypass", async ({
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

test("survey fog changes empty substrate without changing structural wall pixels", async ({
  page,
}) => {
  const undiscovered = await syntheticRendererScreenshot(page, false);
  const discovered = await syntheticRendererScreenshot(page, true);

  expect(await patchDifference(page, undiscovered, discovered)).toBeLessThan(2);
  expect(await patchDifference(page, undiscovered, discovered, { x: -4, y: 0 }))
    .toBeGreaterThan(6);
});

test("survey fog hides Cure pixels until discovery", async ({ page }) => {
  const hiddenEmpty = await syntheticRendererScreenshot(page, false, CellKind.Empty);
  const hiddenCure = await syntheticRendererScreenshot(page, false, CellKind.Cure);
  const discoveredCure = await syntheticRendererScreenshot(page, true, CellKind.Cure);

  expect(await patchDifference(page, hiddenEmpty, hiddenCure)).toBeLessThan(2);
  expect(await patchDifference(page, hiddenCure, discoveredCure)).toBeGreaterThan(6);
});

test("Wall, Abyss, Swamp, and Portal use distinct renderer motifs", async ({
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
    if (!("motif" in visual)) throw new Error("a structural terrain motif was unavailable");
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
