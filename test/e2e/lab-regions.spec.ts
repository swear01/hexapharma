import { expect, test, type Locator, type Page } from "@playwright/test";
import { LAB_CELL_PIXELS, LAB_VIEWPORT, focusLabCamera, visibleLabCells } from "../../src/render/labCamera";
import { generate } from "../../src/sim/mapgen";
import { CellKind } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

const REGION_SEED = 184;
const START_CELL = { x: 31, y: 31 } as const;
const REGION_FOCUS = { x: 51, y: 27 } as const;

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

test("revealed Lab regions retain connected boundaries over the grid without leaking through fog", async ({
  page,
}) => {
  const counts = fixtureRegionCounts();
  for (const kind of [CellKind.Wall, CellKind.Hazard, CellKind.SideEffect, CellKind.Cure]) {
    expect(counts[kind], `seed ${REGION_SEED} viewport must contain cell kind ${kind}`).toBeGreaterThan(0);
  }

  await page.goto(`/?seed=${REGION_SEED}`);
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await panFromStartToRegion(page, frame);
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
  await expect(page.getByTestId("lab-zoom")).not.toContainText("follow");

  expect(await frame.screenshot({ animations: "disabled" })).toMatchSnapshot("lab-regions-hidden.png");
  await page.getByTestId("reveal").check();
  expect(await frame.screenshot({ animations: "disabled" })).toMatchSnapshot("lab-regions-revealed.png");
});
