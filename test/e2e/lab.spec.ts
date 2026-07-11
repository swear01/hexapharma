import { test, expect, type Locator } from "@playwright/test";

/** PNG screenshot bytes of the lab canvas (for fog/reveal pixel-diff assertions). */
async function canvasShot(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot();
}

function differs(a: Buffer, b: Buffer): boolean {
  return a.length !== b.length || !a.equals(b);
}

test("HexaPharma Lab loads a generated level, runs a template, and reports an outcome", async ({
  page,
}) => {
  await page.goto("/");

  // Persistent game shell + Lab canvas present.
  await expect(page.getByTestId("game-shell")).toBeVisible();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Generated-level info should render (seed + per-disease difficulty/price).
  await expect(page.getByTestId("level-info")).toContainText(/seed/i);

  // FOGGED BY DEFAULT: the debug reveal toggle starts OFF.
  await expect(page.getByTestId("reveal")).not.toBeChecked();
  // Reveal the level so the outcome run below is testable without blind exploration.
  await page.getByTestId("reveal").check();

  const status = page.getByTestId("status");
  const before = (await status.textContent())?.trim() ?? "";

  // Build a tiny starter template from the unlocked palette, then Run.
  await page.getByTestId("palette-push").click();
  await page.getByTestId("palette-pull").click();
  await expect(page.getByTestId("template-list")).toContainText("push");
  await expect(page.getByTestId("template-list")).toContainText("pull");

  await page.getByTestId("run").click();

  // The status element must change away from its initial "press Run" prompt and
  // settle on a completed/failed/win outcome (animation lasts a fraction of a second).
  await expect(status).not.toHaveText(before, { timeout: 10_000 });
  await expect(status).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
});

test("The Lab is fogged by default; a run reveals cells; reveal-all toggles", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();

  // Default = fogged (reveal-all OFF). Screenshot the fogged Lab for the record.
  await expect(page.getByTestId("reveal")).not.toBeChecked();
  const fogged = await canvasShot(canvas);
  await page.screenshot({ path: "test/e2e/__screenshots__/lab.png", fullPage: true });
  await expect(page).toHaveScreenshot("lab-fogged.png", {
    fullPage: true,
    animations: "disabled",
  });

  // Reveal-all paints the true features → the canvas must change; un-checking restores fog.
  await page.getByTestId("reveal").check();
  const revealed = await canvasShot(canvas);
  expect(differs(fogged, revealed)).toBe(true);
  await page.getByTestId("reveal").uncheck();

  // A RUN reveals the swept cells into the persistent fog → the fogged canvas changes,
  // and the change persists after Reset (exploration is not undone).
  const beforeRun = await canvasShot(canvas);
  await page.getByTestId("palette-push2").click();
  await page.getByTestId("palette-push2").click();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
  const afterRun = await canvasShot(canvas);
  expect(differs(beforeRun, afterRun)).toBe(true);

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("template-list")).toContainText("Choose a machine");
  const afterReset = await canvasShot(canvas);
  // Reset keeps revealed cells: still differs from the original all-fogged view.
  expect(differs(beforeRun, afterReset)).toBe(true);
});

test("A 3-map level renders (forced via ?nmaps=3)", async ({ page }) => {
  await page.goto("/?nmaps=3");
  await expect(page.getByTestId("level-info")).toContainText(/seed/i);
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();
  // Three diseases-worth of maps render; level-info lists maps 0..2 across the diseases.
  await page.getByTestId("reveal").check();
  await page.screenshot({ path: "test/e2e/__screenshots__/lab-3maps.png", fullPage: true });
});

test("The Lab plays the game's current level", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("level-info")).toContainText("seed 14");
});

test("Reset clears the template back to empty", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("palette-push").click();
  await page.getByTestId("palette-push2").click();
  await expect(page.getByTestId("template-list")).toContainText("push2");

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("template-list")).toContainText("Choose a machine");
});

test("editing a completed template invalidates its stale outcome", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 4; i++) await page.getByTestId("palette-push2").click();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("save-recipe")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("palette-push").click();
  await expect(page.getByTestId("save-recipe")).toBeDisabled();
  await expect(page.getByTestId("status")).toContainText("Build a template");

  await page.getByTestId("remove-last").click();
  await expect(page.getByTestId("save-recipe")).toBeDisabled();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("save-recipe")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("clear").click();
  await expect(page.getByTestId("save-recipe")).toBeDisabled();
  await expect(page.getByTestId("status")).toContainText("Build a template");
});

test("the Lab starts centered on one local layer and supports pan, zoom, and focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-count")).toHaveText("1 map");
  await expect(page.getByTestId("revealed-count")).toHaveText("revealed 49/3969");
  await expect(page.getByTestId("lab-layer-0")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("lab-layer-1")).toHaveCount(0);
  await expect(page.getByTestId("palette-swap01")).toBeDisabled();

  const frame = page.getByTestId("lab-map-frame");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Lab frame has no bounding box");
  const zoom = page.getByTestId("lab-zoom");
  await expect(zoom).toContainText("100% · follow");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect(zoom).not.toContainText("100%");
  await expect(zoom).not.toContainText("follow");

  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 35);
  await page.mouse.up();
  await page.getByTestId("lab-focus").click();
  await expect(zoom).toContainText("100% · follow");
});

test("multi-layer levels expose independent A/B tabs and phase exchange", async ({ page }) => {
  await page.goto("/?nmaps=2");
  await expect(page.getByTestId("lab-layer-0")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("lab-layer-1")).toBeVisible();
  await expect(page.getByTestId("palette-swap01")).toBeEnabled();
  await page.getByTestId("lab-layer-1").click();
  await expect(page.getByTestId("lab-layer-1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("phase-exchange-cue")).toContainText("A receives B");
});

test("a Lab renderer initialization failure is visible and does not escape as an unhandled error", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/src/render/labRenderer.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'export async function createLabRenderer() { throw new Error("synthetic init failure"); }',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("lab-render-error")).toContainText(/could not start.*renderer/i);
  expect(pageErrors).toEqual([]);
});

test("a Lab asset-manifest failure is visible instead of falling back to debug art", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/assets/lab/manifest.json", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/");
  await expect(page.getByTestId("lab-render-error")).toContainText(/asset manifest request failed/i);
  expect(pageErrors).toEqual([]);
});
