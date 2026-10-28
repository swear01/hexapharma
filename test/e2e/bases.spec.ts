import { expect, test, type Locator, type Page } from "@playwright/test";
import { installSaveFixture } from "./checkpoint";
import { openMenu } from "./menu";
import { createGameState } from "../../src/sim/game";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";
import { BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH } from "../../src/sim/phase0_interfaces";
import { hexBoardBounds, hexToPixel } from "../../src/render/hexProjection";

async function factoryCellPoint(frame: Locator, q: number, r: number): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = frame.locator("canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Factory canvas has no bounds");
  const intrinsic = await canvas.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
  const bounds = hexBoardBounds(BASE_GAME_FACTORY_WIDTH, BASE_GAME_FACTORY_HEIGHT, 21);
  const projected = hexToPixel(q, r, 21);
  return {
    x: box.x + (12 - bounds.minX + projected.x) * box.width / intrinsic.width,
    y: box.y + (12 - bounds.minY + projected.y) * box.height / intrinsic.height,
  };
}

async function loadThreeBaseGame(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await installSaveFixture(page, serializeGame(createGameState({ ...defaultGenOptions(14), nMaps: 3 }, 1000)));
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" }).getByRole("button", { name: "Load saved game" }).click();
  await expect(page.getByTestId("research-base-0")).toBeVisible();
}

test("a new game has one base: no base picker in Research, Sources or Technology", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("research-base-0")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-switch-split-merge")).toBeVisible();
  await expect(page.getByTestId("patent-switch-oil-base")).toHaveCount(0);
  await expect(page.getByTestId("patent-switch-ethanol-base")).toHaveCount(0);
  await page.getByRole("button", { name: "Close technology" }).click();
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  await workspace.getByTestId("brush-source").click();
  await expect(workspace.getByTestId("source-base-0")).toHaveCount(0);
});

test("in a three-base game Oil stays locked until Technology turns it on; then Research and Sources can use it", async ({ page }) => {
  await loadThreeBaseGame(page);
  const saline = page.getByTestId("research-base-0");
  const oil = page.getByTestId("research-base-1");
  await expect(saline).toHaveAttribute("aria-pressed", "true");
  await oil.hover();
  await expect(page.getByText("Oil off · turn it on in Technology")).toBeVisible();
  await expect(oil).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-switch-oil-base").click();
  await expect(page.getByTestId("patent-switch-oil-base")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close technology" }).click();
  await oil.click();
  await expect(oil).toHaveAttribute("aria-pressed", "true");
  await expect(saline).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  await workspace.getByTestId("brush-source").click();
  await workspace.getByTestId("source-base-2").hover();
  await expect(workspace.getByText("Ethanol off · turn it on in Technology")).toBeVisible();
  await workspace.getByTestId("source-base-1").click();
  await expect(workspace.getByTestId("source-base-1")).toHaveAttribute("aria-pressed", "true");
  const frame = workspace.getByTestId("factory-canvas");
  const point = await factoryCellPoint(frame, 3, 3);
  await page.mouse.click(point.x, point.y);
  await expect(workspace.getByTestId("source-base-mark")).toHaveText("Oil");
});
