import { expect, test, type Page } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeSnapshot } from "../../src/sim/save";
import { BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH, type GameState } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";
import { machineName } from "../../src/ui/machineLabels";
import { openMenu } from "./menu";

test.setTimeout(90_000);

function discover(game: GameState, disease: number): GameState {
  const program = generate(game.genOptions).diseases[disease]!.reference;
  for (const machine of program.steps) {
    game = applyGameIntent(game, { kind: "advanceResearchShot", machine });
    if (game.research.shot === null) break;
  }
  return game;
}

function fixture(): GameState {
  let game = discover(createGameState(defaultGenOptions(14), 9999, 9999), 0);
  const layout = compileEntitledPrototype(game.research.discoveredFormulas[0]!.program, BASE_GAME_FACTORY_WIDTH, BASE_GAME_FACTORY_HEIGHT).layout;
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
  game = applyGameIntent(game, { kind: "sellProducts", disease: 0, productIds: game.inventory.slice(0, 3).map((product) => product.inventoryId) });
  game = applyGameIntent(game, { kind: "unlockPatent", id: "skew-unlock" });
  return discover(game, 1);
}

async function loadFixture(page: Page, game = fixture()): Promise<void> {
  await page.goto("/");
  await page.evaluate((checkpoint) => localStorage.setItem("hexapharma.save.v11.checkpoint.0", checkpoint), JSON.stringify({ version: 2, head: serializeSnapshot(game), history: [] }));
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("button", { name: "Load saved game", exact: true }).click();
  await page.keyboard.press("Escape");
}

for (const width of [1440, 390]) {
  test(`formula fixture: all discovered diseases remain readable across rooms and Save/Load at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const game = fixture();
    expect(game.research.discoveredFormulas.map((formula) => formula.disease)).toEqual([0, 1]);
    await loadFixture(page, game);
    await page.getByTestId("view-formulas").click();
    const selector = page.getByTestId("formula-select");
    await expect(selector).toHaveValue("1");
    await expect(selector.locator("option")).toHaveCount(2);
    await selector.selectOption("0");
    for (const room of ["research", "pilot", "production"]) {
      await page.getByTestId(`view-${room}`).click();
      await expect(selector).toHaveValue("0");
      const formula = game.research.discoveredFormulas[0]!;
      const panel = page.getByTestId("formula-ribbon");
      await expect(panel.locator("li")).toHaveCount(formula.program.steps.length);
      for (let index = 0; index < formula.program.steps.length; index++) {
        await expect(panel.locator("li").nth(index)).toContainText(machineName(formula.program.steps[index]!.typeId));
      }
      await expect(panel).toContainText(`$${formula.researchCost} assay`);
      await expect(panel).toContainText(formula.outcome.sideEffects.length === 0 ? "Clean" : `${formula.outcome.sideEffects.length} side effect${formula.outcome.sideEffects.length === 1 ? "" : "s"}`);
      await panel.locator("li").last().scrollIntoViewIfNeeded();
      await expect(panel.locator("li").last()).toBeInViewport();
    }
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("save-msg")).toContainText("Saved");
    await page.reload();
    await openMenu(page);
    await page.getByTestId("load").click();
    await page.getByRole("button", { name: "Load saved game", exact: true }).click();
    await page.getByTestId("view-formulas").click();
    await expect(selector.locator("option")).toHaveCount(2);
    await selector.selectOption("0");
    await expect(page.getByTestId("formula-ribbon")).toContainText("Disease 1");

    await loadFixture(page, discover(game, 0));
    await page.getByTestId("view-formulas").click();
    await expect(selector.locator("option")).toHaveCount(2);
    await expect(selector).toHaveValue("0");
  });
}

test("desktop formula reference leaves paid Production placement available", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadFixture(page, discover(createGameState(defaultGenOptions(14), 1000, 0), 0));
  await page.getByTestId("view-formulas").click();
  await page.getByTestId("view-production").click();
  await expect(page.getByTestId("formula-ribbon")).toBeVisible();
  const canvas = page.getByTestId("production-facility-workspace").locator("canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const cash = Number((await page.getByTestId("cash").textContent())!.replace(/[^0-9]/g, ""));
  await page.mouse.click(box.x + 12 + Math.sqrt(3) * 21 / 2, box.y + 12 + 21);
  await expect(page.getByTestId("cash")).toHaveText(String(cash - 2));
  await expect(page.getByTestId("formula-ribbon")).toBeVisible();
  await expect(page.getByTestId("factory-undo")).toBeEnabled();
});

async function readProduction(page: Page): Promise<readonly (string | null)[]> {
  return Promise.all(["factory-tick", "factory-produced", "factory-waste", "cash", "research", "stock"].map((id) => page.getByTestId(id).textContent()));
}

test("full-screen formulas suppress factory input across resize without pausing Production", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadFixture(page, discover(createGameState(defaultGenOptions(14), 1000, 0), 0));
  await page.getByTestId("view-production").click();
  const box = (await page.getByTestId("production-facility-workspace").locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + 12 + Math.sqrt(3) * 21 / 2, box.y + 12 + 21);
  await page.getByTestId("factory-play").click();
  await page.getByTestId("view-formulas").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Discovered formulas" }).click();
  const direction = await page.getByTestId("brush-direction").textContent();
  const tick = Number(await page.getByTestId("factory-tick").textContent());
  await page.keyboard.press("2");
  await page.keyboard.press("r");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("brush-selected")).toHaveText("belt");
  await expect(page.getByTestId("brush-direction")).toHaveText(direction!);
  await expect(page.getByTestId("factory-undo")).toBeEnabled();
  await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(tick);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("brush-belt").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("factory-undo")).toBeDisabled();
});

test("Escape closes Formulas and Menu after their selectors receive focus", async ({ page }) => {
  await loadFixture(page);
  await page.getByTestId("view-formulas").click();
  await page.getByTestId("formula-select").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("formula-ribbon")).toBeHidden();
  await openMenu(page);
  await page.getByTestId("save-slot").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("save-slot")).toBeHidden();
});

test("formula reference restores Research hotkeys only when the world is visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadFixture(page, discover(createGameState(defaultGenOptions(14), 1000, 0), 0));
  await page.getByTestId("view-formulas").click();
  await page.getByRole("heading", { name: "Discovered formulas" }).click();
  const cartridges = page.getByTestId("research-path-hotbar").locator("button");
  const cash = await page.getByTestId("cash").textContent();
  const tested = await page.getByTestId("research-program-count").textContent();
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(cartridges.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cash")).toHaveText(cash!);
  await expect(page.getByTestId("research-program-count")).toHaveText(tested!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("lab-map-frame").click({ position: { x: 20, y: 80 } });
  await page.keyboard.press("2");
  await expect(cartridges.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("research-program-count")).toHaveText("1 tested");
  await expect(page.getByTestId("cash")).not.toHaveText(cash!);
  await expect(page.getByTestId("formula-ribbon")).toBeVisible();
});

for (const action of ["new", "load", "rewind", "reset", "unlock", "delete"] as const) {
  test(`running Production freezes behind ${action} confirmation and Cancel resumes`, async ({ page }) => {
    await loadFixture(page);
    await page.getByTestId("view-production").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-step").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-play").click();
    await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(401);
    if (action === "new" || action === "load" || action === "rewind") {
      await openMenu(page);
      await page.getByTestId(action === "new" ? "new-game" : action).click();
    } else if (action === "reset") {
      await page.getByTestId("factory-reset").click();
    } else if (action === "unlock") {
      await page.getByTestId("view-technology").click();
      await page.getByTestId("patent-unlock-bench-2").click();
    } else {
      await page.getByTestId("view-blueprints").click();
      await page.getByTestId("blueprint-name").fill("Pause fixture");
      await page.getByTestId("blueprint-save-production").click();
      await page.getByRole("button", { name: "Delete Pause fixture", exact: true }).click();
    }
    const modal = page.getByRole("alertdialog");
    await expect(modal).toBeVisible();
    const before = await readProduction(page);
    const checkpoint = await page.evaluate(() => localStorage.getItem("hexapharma.save.v11.checkpoint.0"));
    await page.waitForTimeout(700);
    for (const key of [".", "r", "F1", "m", "Control+s"]) await page.keyboard.press(key);
    expect(await readProduction(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.v11.checkpoint.0"))).toBe(checkpoint);
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(Number(before[0]));
    if (action === "delete") {
      await page.getByRole("button", { name: "Delete Pause fixture", exact: true }).click();
      const beforeDelete = Number(await page.getByTestId("factory-tick").textContent());
      await page.getByRole("button", { name: "Delete blueprint", exact: true }).click();
      await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(beforeDelete);
    }
    await page.getByTestId("view-production").click();
    await page.getByTestId("factory-pause").click();
  });
}

test("Cancel does not start a paused factory; confirmed Load and New stop the previous timer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();
  await openMenu(page);
  await page.getByTestId("new-game").click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-tick")).not.toHaveText("0");
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("button", { name: "Load saved game", exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("factory-play")).toBeEnabled();
  await page.getByTestId("factory-play").click();
  await openMenu(page);
  await page.getByTestId("new-game").click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByTestId("view-production").click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await expect(page.getByTestId("factory-play")).toBeEnabled();
});

for (const action of ["reset", "unlock", "rewind"] as const) {
  test(`confirmed ${action} replaces the runtime and leaves Production paused`, async ({ page }) => {
    await loadFixture(page);
    await page.getByTestId("view-production").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-step").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-play").click();
    if (action === "reset") {
      await page.getByTestId("factory-reset").click();
      await page.getByRole("button", { name: "Reset runtime", exact: true }).click();
    } else if (action === "unlock") {
      await page.getByTestId("view-technology").click();
      await page.getByTestId("patent-unlock-bench-2").click();
      await page.getByTestId("patent-confirm-unlock").click();
    } else {
      await openMenu(page);
      await page.getByTestId("rewind").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Rewind", exact: true }).click();
    }
    await page.getByTestId("view-production").click();
    await expect(page.getByTestId("factory-play")).toBeEnabled();
    const after = await readProduction(page);
    await page.waitForTimeout(500);
    expect(await readProduction(page)).toEqual(after);
  });
}
