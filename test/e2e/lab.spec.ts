import { test, expect } from "@playwright/test";

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

  // Reveal the level so it's testable without blind exploration.
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

  await page.screenshot({ path: "test/e2e/__screenshots__/lab.png", fullPage: true });
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
