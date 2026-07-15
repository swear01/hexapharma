import { expect, test } from "@playwright/test";
import { generate } from "../../src/sim/mapgen";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

test.setTimeout(60_000);

function known(text: string | null): number {
  const match = /revealed (\d+)\/\d+/.exec(text ?? "");
  if (match === null) throw new Error(`could not parse Research known count from ${String(text)}`);
  return Number(match[1]);
}

test("Research is one large centered Atlas with no Route Floor or layer-transfer controls", async ({
  page,
}) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toBeVisible();
  const level = generate(defaultGenOptions(14));
  const start = level.start.pos[0]!;
  expect(start).toEqual(level.mm.maps[0]!.origin);
  await expect(frame).toHaveAttribute("data-camera-x", String(start.x + 0.5));
  await expect(frame).toHaveAttribute("data-camera-y", String(start.y + 0.5));

  const frameBox = await frame.boundingBox();
  const stageBox = await page.getByTestId("game-stage").boundingBox();
  if (frameBox === null || stageBox === null) throw new Error("Research Atlas has no bounds");
  expect(frameBox.width).toBeGreaterThan(stageBox.width * 0.84);
  expect(frameBox.height).toBeGreaterThan(stageBox.height * 0.8);
  await expect(page.getByTestId("research-atlas")).toBeVisible();
  await expect(page.getByTestId("research-workspace")).toBeVisible();
  await expect(page.getByTestId("research-path-hotbar")).toBeVisible();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
  await expect(page.getByTestId("map-count")).toHaveCount(0);
  await expect(page.getByTestId("research-workspace").locator("[data-testid='factory-canvas']"))
    .toHaveCount(0);
  for (const obsolete of [
    "Route Floor",
    "Effect Atlas",
    "Planning is safe",
    "No clock · layout edits are free",
    "swap01",
    "phase transfer",
  ]) {
    await expect(page.getByText(obsolete, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /swap|phase|transfer/i })).toHaveCount(0);
});

test("fixed paths support position preview, world-click commit, and paid Dispense", async ({
  page,
}) => {
  await page.goto("/?cash=200");
  const frame = page.getByTestId("lab-map-frame");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const push = page.getByTestId("research-machine-push");
  await expect(push).toHaveAttribute("aria-pressed", "true");
  await expect(push.locator("[data-icon-shape='path']")).toHaveCount(1);
  await expect(page.getByTestId("research-calibration")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /shorter|longer/i })).toHaveCount(0);

  const fullPreview = await canvas.screenshot({ animations: "disabled" });
  await page.getByTestId("research-machine-push2").click();
  await page.waitForTimeout(50);
  const otherPreview = await canvas.screenshot({ animations: "disabled" });
  expect(otherPreview.equals(fullPreview)).toBe(false);
  await push.click();

  const cash = page.getByTestId("cash");
  const revealed = page.getByTestId("revealed-count");
  const cashBefore = Number(await cash.textContent());
  const revealedBefore = known(await revealed.textContent());
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  const clickWorld = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await clickWorld();
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  await clickWorld();
  await expect(page.getByTestId("research-program-count")).toHaveText("2 placed");
  await expect(cash).toHaveText(String(cashBefore));
  expect(known(await revealed.textContent())).toBe(revealedBefore);

  await page.getByTestId("research-command").click();
  await expect(cash).toHaveText(String(cashBefore - 4));
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect.poll(async () => known(await revealed.textContent())).toBeGreaterThan(revealedBefore);
});

test("machine hotkeys select paths while Enter dispenses the committed program", async ({ page }) => {
  await page.goto("/");
  const hotbar = page.getByTestId("research-path-hotbar");
  const available = DEFAULT_CATALOG.slice(0, 4);
  const fullPaths = await hotbar.locator("[data-icon-shape='path']")
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("points")));
  expect(new Set(fullPaths).size).toBe(available.length);
  await page.keyboard.press("Digit2");
  await expect(page.getByTestId(`research-machine-${available[1]!.typeId}`))
    .toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("[");
  await expect(page.getByTestId("research-calibration")).toHaveCount(0);
  const frame = page.getByTestId("lab-map-frame");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).toHaveText(String(200 - available[1]!.cost));
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("research-program-count")).toHaveText("0 placed");
});

test("Research pan, zoom, and focus preserve the manually controlled camera", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
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

test("compact Research keeps every command and path control reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  const stage = await page.getByTestId("game-stage").boundingBox();
  const nav = await page.getByTestId("nav-rail").boundingBox();
  if (stage === null || nav === null) throw new Error("compact Research chrome has no bounds");
  for (const testId of ["research-command", "research-path-hotbar"]) {
    const control = await page.getByTestId(testId).boundingBox();
    if (control === null) throw new Error(`${testId} has no compact bounds`);
    expect(control.x).toBeGreaterThanOrEqual(stage.x);
    expect(control.x + control.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(control.y).toBeGreaterThanOrEqual(stage.y);
    expect(control.y + control.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(control.y + control.height).toBeLessThanOrEqual(nav.y + 1);
  }
});

test("the Research Atlas has no recipe timeline or unclosable Pilot Bench", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("recipe-track")).toHaveCount(0);
  await expect(page.getByTestId("pilot-bench")).toHaveCount(0);
  await expect(page.getByTestId("research-atlas")).toBeVisible();
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
