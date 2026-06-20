import { test, expect } from "@playwright/test";

// Patent flows, end-to-end against the real game. We start with `?cash=9999` (a thin
// start-cash test hook in Game.tsx) so the player can afford the patents directly.
// Functional assertions only — screenshots are kept for the record, not as baselines.

/** Parse "revealed R/T" from the Lab's revealed-count into its R (revealed) number. */
function revealedOf(text: string | null): number {
  const m = /revealed\s+(\d+)\s*\/\s*\d+/.exec(text ?? "");
  if (!m) throw new Error(`could not parse revealed-count from "${text}"`);
  return Number(m[1]);
}

test("reveal-aid patent: unlocking it spends 80 and grows the revealed area", async ({ page }) => {
  await page.goto("/?cash=9999");

  // Lab starts mostly fogged — record the revealed cell count.
  const revealed = page.getByTestId("revealed-count");
  await expect(revealed).toBeVisible();
  const before = revealedOf(await revealed.textContent());

  // Cash starts at the ?cash override.
  const cash = page.getByTestId("cash");
  const cashBefore = Number((await cash.textContent())?.trim());
  expect(cashBefore).toBe(9999);

  // Patents: unlock reveal-aid (cost 80).
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("unlocked");

  // Cash dropped by exactly 80.
  await expect(cash).toHaveText(String(cashBefore - 80));

  // Back to the Lab: the reveal-aid radius around each start grew the revealed area.
  await page.getByTestId("view-lab").click();
  await expect(revealed).toBeVisible();
  const after = revealedOf(await revealed.textContent());
  expect(after).toBeGreaterThan(before);

  await page.screenshot({ path: "test/e2e/__screenshots__/patents-reveal-aid-lab.png", fullPage: true });
});

test("unlock-map patent: bench-2 + new-map spends 420 and deepens to 3 maps", async ({ page }) => {
  await page.goto("/?cash=9999");

  const cash = page.getByTestId("cash");
  const cashBefore = Number((await cash.textContent())?.trim());
  expect(cashBefore).toBe(9999);

  // The default level is 2 maps at seed 14.
  await expect(page.getByTestId("map-count")).toHaveText("2 maps");

  // Patents: new-map requires bench-2, so unlock bench-2 (120) first, then new-map (300).
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();

  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("available");
  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("unlocked");

  await expect(page.getByTestId("patent-state-new-map")).toHaveText("available");
  await page.getByTestId("patent-unlock-new-map").click();
  await expect(page.getByTestId("patent-state-new-map")).toHaveText("unlocked");

  // Cash dropped by 120 + 300 = 420.
  await expect(cash).toHaveText(String(cashBefore - 420));

  // Back to the Lab: the level deepened — it now shows 3 maps (regenerated at seed 15).
  await page.getByTestId("view-lab").click();
  await expect(page.getByTestId("map-count")).toHaveText("3 maps", { timeout: 10_000 });
  await expect(page.getByTestId("level-info")).toContainText("seed 15");

  await page.screenshot({ path: "test/e2e/__screenshots__/patents-deepened-3maps-lab.png", fullPage: true });
});
