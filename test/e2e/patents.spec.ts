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
  await page.goto("/?cash=9999&research=9999");

  // Lab starts mostly fogged — record the revealed cell count.
  const revealed = page.getByTestId("revealed-count");
  await expect(revealed).toBeVisible();
  const before = revealedOf(await revealed.textContent());

  // Cash starts at the ?cash override.
  const cash = page.getByTestId("cash");
  const cashBefore = Number((await cash.textContent())?.trim());
  expect(cashBefore).toBe(9999);

  // Technology: unlock reveal-aid (cost 80).
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("unlocked");

  // Cash dropped by exactly 80.
  await expect(cash).toHaveText(String(cashBefore - 80));

  // Back to the Lab: the reveal-aid radius around each start grew the revealed area.
  await page.getByTestId("view-research").click();
  await expect(revealed).toBeVisible();
  const after = revealedOf(await revealed.textContent());
  expect(after).toBeGreaterThan(before);

});

test("unlock-map patent: bench-2 + new-map spends 420 and unlocks layer B", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");

  const cash = page.getByTestId("cash");
  const cashBefore = Number((await cash.textContent())?.trim());
  expect(cashBefore).toBe(9999);

  // The default level is one map at seed 14.
  await expect(page.getByTestId("map-count")).toHaveText("1 map");

  // Technology: new-map requires bench-2, so unlock bench-2 (120) first, then new-map (300).
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();

  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("available");
  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("unlocked");

  await expect(page.getByTestId("patent-state-new-map")).toHaveText("available");
  await page.getByTestId("patent-unlock-new-map").click();
  await expect(page.getByTestId("patent-confirmation")).toContainText(
    /Research.*Pilot Plant.*Production runtime.*waste.*inventory.*fog.*sales history/i,
  );
  await page.getByTestId("patent-confirm-new-map").click();
  await expect(page.getByTestId("patent-state-new-map")).toHaveText("unlocked");

  // Cash dropped by 120 + 300 = 420.
  await expect(cash).toHaveText(String(cashBefore - 420));

  // Back to the Lab: the level deepened — it now shows layer B (regenerated at seed 15).
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("map-count")).toHaveText("2 maps", { timeout: 10_000 });
  await expect(page.getByTestId("level-info")).toContainText("seed 15");

});

test("deeper-level unlock requires explicit confirmation and cancel dispatches nothing", async ({
  page,
}) => {
  await page.goto("/?cash=9999&research=9999");
  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-unlock-bench-2").click();
  const cashAfterBench = await page.getByTestId("cash").textContent();

  await page.getByTestId("patent-unlock-new-map").click();
  const confirmation = page.getByTestId("patent-confirmation");
  await expect(confirmation).toContainText(
    /Research.*Pilot Plant.*Production runtime.*waste.*inventory.*fog.*sales history/i,
  );
  await page.getByTestId("patent-cancel-new-map").click();

  await expect(confirmation).toBeHidden();
  await expect(page.getByTestId("patent-state-new-map")).toHaveText("available");
  await expect(page.getByTestId("cash")).toHaveText(cashAfterBench ?? "");
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("map-count")).toHaveText("1 map");
});
