import { test, expect } from "@playwright/test";

test("HexaPharma Factory runs the belt sim and produces units", async ({ page }) => {
  await page.goto("/");

  // Switch to the Factory view.
  await page.getByTestId("view-factory").click();

  // Heading + canvas + run controls present.
  await expect(page.getByRole("heading", { name: /HexaPharma Factory/i })).toBeVisible();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("factory-play")).toBeVisible();
  await expect(page.getByTestId("factory-step")).toBeVisible();
  await expect(page.getByTestId("factory-reset")).toBeVisible();

  // The default factory reports a bottleneck (slow pull) and a throughput rate.
  await expect(page.getByTestId("factory-bottleneck")).toHaveText(/pull/i);

  const tick = page.getByTestId("factory-tick");
  await expect(tick).toHaveText("0");

  // Step several times: the tick counter advances.
  for (let i = 0; i < 6; i++) await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("6");

  // Play advances the sim on a timer; a unit reaches the sink and produced climbs.
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();

  // Reset returns the tick to 0.
  await page.getByTestId("factory-reset").click();
  await expect(tick).toHaveText("0");

  await page.screenshot({ path: "test/e2e/__screenshots__/factory.png", fullPage: true });
});

test("Factory editing places a parallel machine to relieve the bottleneck", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  // Default bottleneck is the slow pull (speed 3) ⇒ rate limited to 1/3.
  await expect(page.getByTestId("factory-bottleneck")).toHaveText(/pull/i);
  await expect(page.getByTestId("factory-rate")).toHaveText("1/3");

  // Select the pull machine brush at speed 1 and place a parallel copy.
  await page.getByTestId("brush-machine-pull").click();
  await expect(page.getByTestId("brush-selected")).toContainText("pull");
  await page.getByTestId("brush-speed").fill("1");

  // Click a cell on a lower row to add a second pull stage (parallel copy).
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  // Cell math mirrors the renderer: PAD=12, CELL=56. Row 3 (y), col 3 (x).
  const x = box.x + (12 + 3 * 56 + 28);
  const y = box.y + (12 + 3 * 56 + 28);
  await page.mouse.click(x, y);

  // Pull stage now 1/3 + 1/1 = 4/3, so it's no longer the bottleneck: the rate
  // rises to 1 (limited by the speed-1 stages / source) and bottleneck clears.
  await expect(page.getByTestId("factory-rate")).toHaveText("1/1");
});
