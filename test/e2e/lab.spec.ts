import { test, expect, type Locator, type Page } from "@playwright/test";

test.setTimeout(60_000);

/** PNG screenshot bytes of the lab canvas (for fog/reveal pixel-diff assertions). */
async function canvasShot(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot();
}

function differs(a: Buffer, b: Buffer): boolean {
  return a.length !== b.length || !a.equals(b);
}

async function placeAtEnd(page: Page, typeId: string): Promise<void> {
  await page.getByTestId(`palette-${typeId}`).click();
  const count = Number((await page.getByTestId("template-count").textContent()) ?? "0");
  await page.getByTestId(`recipe-insert-${count}`).click();
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
  await placeAtEnd(page, "push");
  await placeAtEnd(page, "pull");
  await expect(page.getByTestId("template-list")).toContainText(/push/i);
  await expect(page.getByTestId("template-list")).toContainText(/pull/i);

  await page.getByTestId("run").click();

  // The status element must change away from its initial "press Run" prompt and
  // settle on a completed/failed/win outcome (animation lasts a fraction of a second).
  await expect(status).not.toHaveText(before, { timeout: 10_000 });
  await expect(status).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
});

test("a moved Pilot machine keeps its exact anchor when the cure is sent to Factory", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  for (let index = 0; index < 8; index++) await placeAtEnd(page, "push");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toContainText(/WIN/i, { timeout: 10_000 });
  await expect(page.getByTestId("save-recipe")).toBeEnabled();

  const pilot = page.getByTestId("pilot-bench");
  await pilot.locator("[data-x='1'][data-y='6']").click();
  await pilot.locator("[data-x='23'][data-y='11']").click();
  await expect(pilot.getByRole("status")).toContainText(/outside the pilot bench/i);
  await expect(page.getByTestId("save-recipe")).toBeDisabled();
  await pilot.getByRole("button", { name: "Auto arrange" }).click();
  await expect(pilot.getByRole("status")).toContainText(/auto-arranged/i);
  await expect(page.getByTestId("save-recipe")).toBeEnabled();

  await pilot.locator("[data-x='1'][data-y='6']").click();
  await pilot.locator("[data-x='1'][data-y='3']").click();
  await expect(pilot.getByRole("status")).toContainText(/moved.*rerouted/i);
  await page.getByTestId("save-recipe").click();

  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("factory canvas has no bounding box");
  await page.mouse.move(box.x + 12 + 1 * 42 + 21, box.y + 12 + 3 * 42 + 21);
  await expect(page.getByTestId("factory-hover-kind")).toContainText(/machine:Push/i);
  await page.mouse.move(box.x + 12 + 1 * 42 + 21, box.y + 12 + 6 * 42 + 21);
  await expect(page.getByTestId("factory-hover-kind")).not.toContainText(/machine:/i);
});

test("The Lab is fogged by default; a run reveals cells; reveal-all toggles", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Default = fogged (reveal-all OFF). Screenshot the fogged Lab for the record.
  await expect(page.getByTestId("reveal")).not.toBeChecked();
  await page.screenshot({ path: "test/e2e/__screenshots__/lab.png", fullPage: true });
  await expect(page).toHaveScreenshot("lab-fogged.png", {
    fullPage: true,
    animations: "disabled",
  });

  // Reveal-all paints the true features → the canvas must change; un-checking restores fog.
  await page.getByTestId("reveal").check();
  await expect(page.getByTestId("reveal")).toBeChecked();
  await page.getByTestId("reveal").uncheck();
  await expect(page.getByTestId("reveal")).not.toBeChecked();

  // A RUN reveals the swept cells into the persistent fog → the fogged canvas changes,
  // and the change persists after Reset (exploration is not undone).
  const beforeRun = await canvasShot(canvas);
  const revealedBeforeRun = await page.getByTestId("revealed-count").textContent();
  await placeAtEnd(page, "push2");
  await placeAtEnd(page, "push2");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
  await expect(page.getByTestId("revealed-count")).not.toHaveText(revealedBeforeRun ?? "");
  const revealedAfterRun = await page.getByTestId("revealed-count").textContent();
  const afterRun = await canvasShot(canvas);
  expect(differs(beforeRun, afterRun)).toBe(true);

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("template-list")).toContainText("Choose a machine");
  // Reset keeps persistent exploration authority even though the recipe route disappears.
  await expect(page.getByTestId("revealed-count")).toHaveText(revealedAfterRun ?? "");
});

test("A 3-map level renders (forced via ?nmaps=3)", async ({ page }) => {
  await page.goto("/?nmaps=3");
  await expect(page.getByTestId("level-info")).toContainText(/seed/i);
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
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
  await placeAtEnd(page, "push");
  await placeAtEnd(page, "push2");
  await expect(page.getByTestId("template-list")).toContainText(/long push/i);

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("template-list")).toContainText("Choose a machine");
});

test("Recipe commands preview their insertion and map result before commit", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("reveal").check();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const beforePreview = await canvasShot(canvas);

  await page.getByTestId("palette-push").click();
  await expect(page.getByTestId("template-count")).toHaveText("0");
  await expect(page.getByTestId("recipe-held")).toContainText(/Push/i);
  await expect(page.getByTestId("recipe-insert-0")).toHaveAttribute("data-previewing", "true");
  await expect(page.getByTestId("lab-preview-state")).toContainText(/step 1/i);
  await expect.poll(async () => differs(beforePreview, await canvasShot(canvas))).toBe(true);

  await page.getByTestId("recipe-insert-0").click();
  await expect(page.getByTestId("template-count")).toHaveText("1");
  await expect(page.getByTestId("recipe-step-0")).toHaveAttribute("aria-selected", "false");

  await page.getByTestId("palette-pull").click();
  await page.getByTestId("recipe-insert-0").hover();
  await expect(page.getByTestId("recipe-insert-0")).toHaveAttribute("data-previewing", "true");
  await page.getByTestId("recipe-insert-0").click();
  await expect(page.getByTestId("recipe-step-0")).toContainText(/Pull/i);
  await expect(page.getByTestId("recipe-step-1")).toContainText(/Push/i);

  await page.keyboard.press("Escape");
  await page.getByTestId("recipe-step-1").click();
  await expect(page.getByTestId("recipe-step-1")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("r");
  await expect(page.getByTestId("recipe-step-1")).toHaveAttribute("data-rotation", "1");

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("recipe-step-1")).toHaveAttribute("data-rotation", "0");
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("recipe-step-1")).toHaveAttribute("data-rotation", "1");

  const first = await page.getByTestId("recipe-step-0").boundingBox();
  const second = await page.getByTestId("recipe-step-1").boundingBox();
  if (first === null || second === null) throw new Error("recipe cards have no bounding box");
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width + 18, second.y + second.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("recipe-step-0")).toContainText(/Push/i);
  await expect(page.getByTestId("recipe-step-1")).toContainText(/Pull/i);
});

test("Run locks Recipe authority until its captured template finishes", async ({ page }) => {
  await page.goto("/");
  for (let index = 0; index < 4; index++) await placeAtEnd(page, "push2");
  await expect(page.getByTestId("template-count")).toHaveText("4");

  await page.getByTestId("run").click();
  await expect(page.getByTestId("run")).toContainText("Stop");
  await expect(page.getByTestId("recipe-step-0")).toBeDisabled();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Delete");
  await page.keyboard.press("r");
  await expect(page.getByTestId("template-count")).toHaveText("4");
  for (let index = 0; index < 4; index++) {
    await expect(page.getByTestId(`recipe-step-${index}`)).toHaveAttribute("data-rotation", "0");
  }

  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN|FAILED/i, { timeout: 10_000 });
  await expect(page.getByTestId("template-count")).toHaveText("4");
});

test("editing a completed template invalidates its stale outcome", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 4; i++) await placeAtEnd(page, "push2");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("save-recipe")).toBeVisible({ timeout: 10_000 });

  await placeAtEnd(page, "push");
  await expect(page.getByTestId("save-recipe")).toBeDisabled();
  await expect(page.getByTestId("status")).toContainText("Build a template");

  await page.keyboard.press("Escape");
  await page.getByTestId("recipe-step-4").click();
  await page.keyboard.press("Delete");
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
