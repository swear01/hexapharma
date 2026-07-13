import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test("facility hotkeys switch three world pages while utility hotkeys open drawers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-research")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F2");
  await expect(page.getByTestId("view-pilot")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F3");
  await expect(page.getByTestId("view-production")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F1");
  await expect(page.getByTestId("view-research")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("m");
  await expect(page.getByTestId("market-drawer")).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.getByTestId("technology-drawer")).toBeVisible();
  await page.keyboard.press("b");
  await expect(page.getByTestId("blueprints-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("blueprints-drawer")).toHaveCount(0);
});

test("Pilot spatial editing supports palette, rotate, drag paint, erase, undo, redo, and zoom", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  const frame = pilot.getByTestId("factory-canvas");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Pilot canvas has no bounds");
  await pilot.getByTestId("brush-belt").click();
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toContainText("S");
  const x = box.x + 12 + 10 * 42 + 21;
  const y = box.y + 12 + 6 * 42 + 21;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 84, y, { steps: 5 });
  await page.mouse.up();
  await expect(pilot.getByTestId("factory-undo")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(pilot.getByTestId("factory-redo")).toBeEnabled();
  await page.keyboard.press("Control+y");
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await frame.hover();
  await page.mouse.wheel(0, -500);
  await expect(pilot.getByTestId("factory-zoom")).not.toHaveText("100%");
});

test("the world canvas remains primary and the inspector never covers it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  const world = pilot.locator(".factory-world");
  const inspector = pilot.getByTestId("factory-inspector");
  const worldBox = await world.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  if (worldBox === null || inspectorBox === null) throw new Error("facility layout missing");
  expect(worldBox.width).toBeGreaterThan(inspectorBox.width * 2);
  expect(worldBox.x + worldBox.width).toBeLessThanOrEqual(inspectorBox.x + 1);
});
