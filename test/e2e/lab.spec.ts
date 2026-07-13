import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";
import { BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH } from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

function known(text: string | null): number {
  const match = /revealed (\d+)\/\d+/.exec(text ?? "");
  if (match === null) throw new Error(`could not parse Research known count from ${String(text)}`);
  return Number(match[1]);
}

function plannedResearchSave(): string {
  const options = defaultGenOptions(14);
  const layout = compileEntitledPrototype(
    generate(options).diseases[0]!.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  const game = applyGameIntent(createGameState(options, 10_000, 0), {
    kind: "setResearchLayout",
    layout,
  });
  return serializeGame(game);
}

async function loadPlannedResearch(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), plannedResearchSave());
  await page.reload();
  await page.getByTestId("load").click();
}

test("Research opens on a large centered atlas and supports manual pan, zoom, and focus", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
  await expect(frame).toHaveAttribute("data-camera-x", "31.5");
  await expect(frame).toHaveAttribute("data-camera-y", "31.5");
  const statusBox = await page.locator(".research-atlas-status").boundingBox();
  if (statusBox === null) throw new Error("Research status bar has no bounds");
  expect(statusBox.height).toBeLessThan(70);
  await expect(page.getByTestId("research-atlas")).toHaveScreenshot("research-atlas-current.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research atlas has no bounds");
  expect(box.width / box.height).toBeCloseTo(704 / 512, 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.wheel(0, -500);
  await expect(page.getByTestId("lab-zoom")).not.toContainText("100%");
  await page.keyboard.press("f");
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
});

test("compact Research keeps atlas status above the facility navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });

  const status = await page.locator(".research-atlas-status").boundingBox();
  const nav = await page.getByTestId("nav-rail").boundingBox();
  if (status === null || nav === null) throw new Error("compact Research chrome has no bounds");
  expect(status.y + status.height).toBeLessThanOrEqual(nav.y);
  expect(status.height).toBeLessThanOrEqual(56);
  const overflow = await page.locator(".research-atlas-status").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  const focusOverflow = await page.getByTestId("lab-focus").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(focusOverflow.scrollWidth).toBeLessThanOrEqual(focusOverflow.clientWidth);
  await expect(page.getByTestId("game-stage")).toHaveScreenshot("compact-research-atlas.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("planning on the physical Research floor does not reveal fog; Dispense does", async ({ page }) => {
  await loadPlannedResearch(page);
  const status = page.getByTestId("revealed-count");
  const before = known(await status.textContent());
  await page.getByTestId("research-show-floor").click();
  await expect(page.getByTestId("factory-canvas").locator("canvas")).toBeVisible();
  await page.getByTestId("research-show-atlas").click();
  expect(known(await status.textContent())).toBe(before);
  const frame = page.getByTestId("lab-map-frame");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research atlas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const cameraBeforeShot = {
    x: await frame.getAttribute("data-camera-x"),
    y: await frame.getAttribute("data-camera-y"),
  };
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 10_000 });
  expect(known(await status.textContent())).toBeGreaterThan(before);
  await expect(frame).toHaveAttribute("data-camera-x", cameraBeforeShot.x!);
  await expect(frame).toHaveAttribute("data-camera-y", cameraBeforeShot.y!);
});

test("the Research atlas has no recipe timeline or unclosable Pilot Bench", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("recipe-track")).toHaveCount(0);
  await expect(page.getByTestId("pilot-bench")).toHaveCount(0);
  await expect(page.getByTestId("research-show-floor")).toBeVisible();
});

test("a Research renderer initialization failure is visible and handled", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/src/render/labRenderer.ts*", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: 'export async function createLabRenderer() { throw new Error("synthetic init failure"); }',
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(/synthetic init failure/i);
  expect(errors).toEqual([]);
});
