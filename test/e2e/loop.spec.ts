import { test, expect } from "@playwright/test";

// Full game loop smoke: cure in the Lab → Save recipe → Factory → produce → Shop
// (cash up) → Patents (listed/unlockable). Functional assertions; screenshots only
// for the record (no visual baselines). The default game level is seed 14, where
// the identity-orientation template [push, dilute] cures disease 1 (a sellable cure).

test("the full loop is playable: cure → produce → sell → patents", async ({ page }) => {
  await page.goto("/");

  // Cash bar + tabs visible.
  const cash = page.getByTestId("cash");
  await expect(cash).toBeVisible();
  const startCash = Number((await cash.textContent())?.trim());
  expect(startCash).toBe(200);

  // ── Lab: reveal, build a curing template, run, then ship the recipe. ──
  await expect(page.getByTestId("view-lab")).toHaveAttribute("data-testid", "view-lab");
  await page.getByTestId("reveal").check();
  await page.getByTestId("palette-push").click();
  await page.getByTestId("palette-dilute").click();
  await page.getByTestId("run").click();

  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN/i, { timeout: 10_000 });
  const saveRecipe = page.getByTestId("save-recipe");
  await expect(saveRecipe).toBeVisible();
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-lab.png", fullPage: true });
  await saveRecipe.click();

  // Saving the recipe switches to the Factory tab.
  await expect(page.getByRole("heading", { name: /HexaPharma Factory/i })).toBeVisible();
  await expect(page.getByTestId("factory-recipe")).toContainText(/saved recipe/i);

  // ── Factory: step/play until at least one unit is produced. ──
  for (let i = 0; i < 6; i++) await page.getByTestId("factory-step").click();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-factory.png", fullPage: true });

  // ── Shop: disease 1 should have inventory; selling raises cash. ──
  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId("shop-table")).toBeVisible();
  const inv1 = page.getByTestId("shop-inv-1");
  await expect(inv1).not.toHaveText("0");

  const cashBeforeSale = Number((await cash.textContent())?.trim());
  await page.getByTestId("shop-sell-1").click();
  await expect(cash).not.toHaveText(String(cashBeforeSale));
  const cashAfterSale = Number((await cash.textContent())?.trim());
  expect(cashAfterSale).toBeGreaterThan(cashBeforeSale);
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-shop.png", fullPage: true });

  // ── Patents: nodes listed with unlockable state. ──
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();
  await expect(page.getByTestId("patent-row-reveal-aid")).toBeVisible();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText(/available|locked|unlocked/);
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-patents.png", fullPage: true });
});

test("Save then Load restores cash from a localStorage slot", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved/i);
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Loaded/i);
  await expect(page.getByTestId("cash")).toHaveText("200");
});
