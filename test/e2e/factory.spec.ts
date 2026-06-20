import { test, expect, type Page } from "@playwright/test";

/** Parse the "num/den" throughput rate shown in the status bar into a number. */
async function rate(page: Page): Promise<number> {
  const txt = (await page.getByTestId("factory-rate").textContent())?.trim() ?? "0";
  const m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(txt);
  if (!m) return Number(txt);
  return Number(m[1]) / Number(m[2]);
}

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

  // The default line reports a real machine bottleneck (id + type) and a rate.
  await expect(page.getByTestId("factory-bottleneck")).toContainText(/#\d+\s*\(/);
  await expect(page.getByTestId("factory-rate")).toHaveText(/^\d+\/\d+$/);

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

test("real parallelism: splitter→two machines→merger out-produces a single machine", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  // Load the SINGLE-machine preset (one speed-3 machine) and read its steady rate.
  await page.getByTestId("preset-single").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  const single = await rate(page);
  expect(single).toBeGreaterThan(0);

  // Single preset is machine-limited: one machine is the bottleneck.
  await expect(page.getByTestId("factory-bottleneck")).toContainText(/#\d+\s*\(/);

  // Load the PARALLEL preset (splitter → two machines → merger) and read its rate.
  await page.getByTestId("preset-parallel").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  const parallel = await rate(page);

  // Real parallelism: two machines on the same feed beat one (~2×, MEASURED by the sim).
  expect(parallel).toBeGreaterThan(single * 1.5);

  // And the parallel layout actually produces units when run.
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
});

test("Factory editing places a machine + a tile via the palette", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  // Cell center math mirrors the renderer: PAD=12, CELL=56 → center = 12 + c*56 + 28.
  const center = (c: number) => 12 + c * 56 + 28;

  // Select a machine type (its footprint = its shape) and rotate the footprint.
  await page.getByTestId("brush-machine-pull").click();
  await expect(page.getByTestId("brush-selected")).toContainText("pull");
  await page.getByTestId("brush-footrot").click();
  await expect(page.getByTestId("brush-footrot")).toContainText("footRot: 1");
  await page.getByTestId("brush-speed").fill("1");

  // Click an empty cell on a lower row to place the machine (added to layout.machines).
  await page.mouse.click(box.x + center(3), box.y + center(3));
  // Editing re-inits the sim → tick resets to 0.
  await expect(page.getByTestId("factory-tick")).toHaveText("0");

  // Place a belt tile too (direction toggle works for tiles).
  await page.getByTestId("brush-belt").click();
  await page.getByTestId("brush-rotate").click(); // → S
  await expect(page.getByTestId("brush-rotate")).toContainText("S");
  await page.mouse.click(box.x + center(4), box.y + center(3));
  await expect(page.getByTestId("factory-tick")).toHaveText("0");

  // The sim still steps after edits (no crash; counter advances).
  await page.getByTestId("factory-step").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("1");
});
