import { test, expect } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { serializeGame, serializeSlots } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";

const legacyDefault = createGameState(defaultGenOptions(14), 200, 0);
const legacyDefaultHead = serializeGame(legacyDefault);
const legacyDefaultHistory = serializeSlots([legacyDefault]);
const legacyRich = createGameState(defaultGenOptions(14), 9_999, 9_999);
const legacyRichHistory = serializeSlots([legacyRich]);
const legacyRichNextHead = serializeGame(
  applyGameIntent(legacyRich, { kind: "unlockPatent", id: "reveal-aid" }),
);

// Full game loop smoke: cure in the Lab → Save recipe → Factory → produce → Shop
// (cash up) → Patents (listed/unlockable). Functional assertions; screenshots only
// for the record (no visual baselines). The default game level is seed 14, where
// the starter-machine template [push×5, swap01] cures disease 0 (a sellable cure).

test("the full loop is playable: cure → produce → sell → patents", async ({ page }) => {
  await page.goto("/");

  // Cash bar + tabs visible.
  const cash = page.getByTestId("cash");
  await expect(cash).toBeVisible();
  const startCash = Number((await cash.textContent())?.trim());
  expect(startCash).toBe(200);
  await expect(page.getByTestId("research")).toHaveText("0");

  // ── Lab: reveal, build a curing template, run, then ship the recipe. ──
  await expect(page.getByTestId("view-lab")).toHaveAttribute("data-testid", "view-lab");
  await page.getByTestId("reveal").check();
  for (let i = 0; i < 5; i++) await page.getByTestId("palette-push").click();
  await page.getByTestId("palette-swap01").click();
  await page.getByTestId("run").click();

  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN/i, { timeout: 10_000 });
  const saveRecipe = page.getByTestId("save-recipe");
  await expect(saveRecipe).toBeVisible();
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-lab.png", fullPage: true });
  await saveRecipe.click();

  // Saving the recipe switches to the Factory tab.
  await expect(page.getByRole("heading", { name: /HexaPharma Factory/i })).toBeVisible();
  await expect(page.getByTestId("factory-recipe")).toContainText(/saved recipe/i);
  await expect(page.getByTestId("factory-status")).toContainText(/total sink outcomes.*includes waste/i);

  // ── Factory: step/play until at least one unit is produced. ──
  for (let i = 0; i < 6; i++) await page.getByTestId("factory-step").click();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.screenshot({ path: "test/e2e/__screenshots__/loop-factory.png", fullPage: true });

  // ── Shop: disease 0 should have inventory; selling raises cash. ──
  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId("shop-table")).toBeVisible();
  const inv1 = page.getByTestId("shop-inv-0");
  await expect(inv1).not.toHaveText("0");

  const cashBeforeSale = Number((await cash.textContent())?.trim());
  await page.getByTestId("shop-sell-0").click();
  await expect(cash).not.toHaveText(String(cashBeforeSale));
  const cashAfterSale = Number((await cash.textContent())?.trim());
  expect(cashAfterSale).toBeGreaterThan(cashBeforeSale);
  await expect(page.getByTestId("research")).toHaveText("1");
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

test("a save commits head and bounded history with one atomic localStorage write", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (key: string, value: string): void {
      calls++;
      if (calls === 2) throw new DOMException("test quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });

  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 1/i);
  const checkpoint = await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0"));
  expect(checkpoint).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.slot.0"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.history.0"))).toBeNull();

  for (let i = 0; i < 24; i++) await page.getByTestId("save").click();
  const historyLength = await page.evaluate(() => {
    const raw = localStorage.getItem("hexapharma.save.checkpoint.0");
    if (raw === null) throw new Error("missing checkpoint");
    return (JSON.parse(raw) as { history: unknown[] }).history.length;
  });
  expect(historyLength + 1).toBe(20);
});

test("corrupt history offers explicit recovery instead of being silently cleared", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("hexapharma.save.history.0", "{broken history");
  });
  await page.reload();

  await expect(page.getByTestId("save-msg")).toContainText(/history is invalid/i);
  await expect(page.getByTestId("recover-storage")).toBeVisible();
  await page.getByTestId("recover-storage").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Recovered slot 1/i);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.history.0"))).toBe(
    "{broken history",
  );
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Loaded slot 1/i);
});

test("recovery salvages a valid canonical head when only its history is corrupt", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await page.getByTestId("view-patents").click();
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await page.getByTestId("save").click();
  await page.evaluate(() => {
    const key = "hexapharma.save.checkpoint.0";
    const raw = localStorage.getItem(key);
    if (raw === null) throw new Error("missing checkpoint");
    const checkpoint = JSON.parse(raw) as { history: string };
    checkpoint.history = "{broken history";
    localStorage.setItem(key, JSON.stringify(checkpoint));
  });
  await page.reload();

  await expect(page.getByTestId("save-msg")).toContainText(/checkpoint is invalid/i);
  await expect(page.getByTestId("recover-storage")).toHaveAttribute("aria-label", /validated timeline/i);
  await page.getByTestId("recover-storage").click();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");
});

test("an interrupted legacy second write is detected and recoverable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(({ head, history }) => {
    localStorage.removeItem("hexapharma.save.checkpoint.0");
    localStorage.setItem("hexapharma.save.slot.0", head);
    localStorage.setItem("hexapharma.save.history.0", history);
  }, { head: legacyRichNextHead, history: legacyRichHistory });
  await page.reload();

  await expect(page.getByTestId("save-msg")).toContainText(/interrupted write/i);
  await page.getByTestId("recover-storage").click();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");
});

test("a validated legacy slot migrates visibly to one canonical checkpoint", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(({ head, history }) => {
    localStorage.removeItem("hexapharma.save.checkpoint.0");
    localStorage.setItem("hexapharma.save.slot.0", head);
    localStorage.setItem("hexapharma.save.history.0", history);
  }, { head: legacyDefaultHead, history: legacyDefaultHistory });
  await page.reload();

  await expect(page.getByTestId("save-msg")).toContainText(/Migrated slot 1/i);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .not.toBeNull();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Loaded slot 1/i);
});

test("a Factory renderer import failure is visible and handled", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/src/render/factoryRenderer.ts*", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  await expect(page.getByTestId("factory-render-error")).toContainText(/could not start.*renderer/i);
  expect(pageErrors).toEqual([]);
});
