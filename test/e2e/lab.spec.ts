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

  // Heading + canvas present.
  await expect(page.getByRole("heading", { name: /HexaPharma/i })).toBeVisible();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();

  // Generated-level info should render (seed + per-disease difficulty/price).
  await expect(page.getByTestId("level-info")).toContainText(/seed/i);

  // FOGGED BY DEFAULT: the debug reveal toggle starts OFF.
  await expect(page.getByTestId("reveal")).not.toBeChecked();
  // Reveal the level so the outcome run below is testable without blind exploration.
  await page.getByTestId("reveal").check();

  const status = page.getByTestId("status");
  const before = (await status.textContent())?.trim() ?? "";

  // Build a tiny template from the palette (incl. the offset `skew` machine), then Run.
  await page.getByTestId("palette-push").click();
  await page.getByTestId("palette-skew").click();
  await expect(page.getByTestId("template-list")).toContainText("push");
  await expect(page.getByTestId("template-list")).toContainText("skew");

  await page.getByTestId("run").click();

  // The status element must change away from its initial "press Run" prompt and
  // settle on a completed/failed/win outcome (animation lasts a fraction of a second).
  await expect(status).not.toHaveText(before, { timeout: 10_000 });
  await expect(status).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
});

test("The Lab is fogged by default; a run reveals cells; reveal-all toggles", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();

  // Default = fogged (reveal-all OFF). Screenshot the fogged Lab for the record.
  await expect(page.getByTestId("reveal")).not.toBeChecked();
  const fogged = await canvasShot(canvas);
  await page.screenshot({ path: "test/e2e/__screenshots__/lab.png", fullPage: true });

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
  await expect(page.getByTestId("template-list")).toContainText("empty");
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
  await expect(page.getByTestId("template-list")).toContainText("empty");
});
