import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  DEFAULT_CATALOG,
  type FactoryTile,
  type Rotation,
  type Template,
} from "../../src/sim/phase0_interfaces";
import { evaluate, initialState } from "../../src/sim/drug-graph";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileTemplate } from "../../src/sim/recipe";
import { serializeGame, serializeGameAuthority } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";

test.setTimeout(60_000);

const SEED = 14;
const level = generate(defaultGenOptions(SEED));
const reference: Template = (() => {
  const found = level.diseases[0]?.reference;
  if (!found) throw new Error(`seed ${SEED} did not generate a disease reference`);
  return found;
})();
const referenceOutcome = evaluate(level.mm, initialState(level.mm), reference);
const swap = DEFAULT_CATALOG.find((entry) => entry.typeId === "swap01");
if (swap === undefined) throw new Error("missing swap01 fixture machine");
const factoryContractRecipe: Template = {
  steps: [
    ...reference.steps,
    { typeId: swap.typeId, transform: swap.transform, orientation: { rot: 0, flip: false } },
    { typeId: swap.typeId, transform: swap.transform, orientation: { rot: 0, flip: false } },
  ],
};
if (
  JSON.stringify(evaluate(level.mm, initialState(level.mm), factoryContractRecipe)) !==
  JSON.stringify(referenceOutcome)
) {
  throw new Error("expanded factory contract fixture no longer preserves the reference outcome");
}
const referenceDisease: number = (() => {
  const found = referenceOutcome.cured[0];
  if (found === undefined) throw new Error(`seed ${SEED} reference did not cure a disease`);
  return found;
})();
function templateOf(steps: readonly (readonly [string, Rotation])[]): Template {
  return {
    steps: steps.map(([typeId, rot]) => {
    const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
    if (!entry) throw new Error(`missing catalog entry ${typeId}`);
      return { typeId, transform: entry.transform, orientation: { rot, flip: false } };
    }),
  };
}

const sideEffectTemplate = templateOf([
  ["push", 0],
  ["push2", 0],
  ["push2", 1],
  ["swap01", 0],
  ["push2", 1],
]);
const sideEffectOutcome = evaluate(level.mm, initialState(level.mm), sideEffectTemplate);
if (sideEffectOutcome.failed || sideEffectOutcome.cured.length === 0 || sideEffectOutcome.sideEffects.length === 0) {
  throw new Error(`seed ${SEED} side-effect fixture is no longer a downgraded cure`);
}
const sideEffectDisease = sideEffectOutcome.cured[0] as number;
const sideEffectProductionCost = sideEffectTemplate.steps.reduce((total, step) => {
  return total + (DEFAULT_CATALOG.find((entry) => entry.typeId === step.typeId)?.cost ?? 0);
}, 0);
const failedTemplate = templateOf([
  ["push", 1],
  ["push2", 1],
  ["swap01", 0],
  ["push2", 1],
  ["swap01", 0],
  ["push2", 1],
]);
const failedOutcome = evaluate(level.mm, initialState(level.mm), failedTemplate);
if (!failedOutcome.failed) throw new Error(`seed ${SEED} failed fixture no longer crosses a hazard`);
const failedFinalTouchesCure = level.diseases.some((disease) => {
  const final = failedOutcome.final[disease.map];
  return final?.x === disease.node.x && final.y === disease.node.y;
});
if (!failedFinalTouchesCure) throw new Error(`seed ${SEED} failed fixture no longer finishes on a cure`);
function saveWithFactory(template: Template): string {
  let game = createGameState(defaultGenOptions(SEED), 9999, 9999);
  game = applyGameIntent(game, { kind: "saveRecipe", recipe: factoryContractRecipe });
  const target = game.factory!;
  const source = compileTemplate(template);
  if (source.width > target.width || source.height > target.height) {
    throw new Error("divergent factory fixture exceeds its recipe-authorized dimensions");
  }
  const tiles: FactoryTile[] = Array.from(
    { length: target.width * target.height },
    () => ({ kind: "empty" as const }),
  );
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      tiles[y * target.width + x] = source.tiles[y * source.width + x]!;
    }
  }
  game = applyGameIntent(game, {
    kind: "setFactory",
    factory: {
      width: target.width,
      height: target.height,
      tiles,
      machines: source.machines,
    },
  });
  return serializeGame(game);
}
const failedSave = saveWithFactory(failedTemplate);
const divergentCureSave = saveWithFactory(sideEffectTemplate);
const freshNoFactorySave = serializeGame(createGameState(defaultGenOptions(SEED), 200, 0));
let bulkSaleGame = createGameState(defaultGenOptions(SEED), 200, 0);
bulkSaleGame = applyGameIntent(bulkSaleGame, { kind: "saveRecipe", recipe: reference });
bulkSaleGame = applyGameIntent(bulkSaleGame, { kind: "factoryTicks", ticks: 4_200 });
const bulkSaleCount = bulkSaleGame.inventory.filter((product) =>
  product.outcome.cured.includes(referenceDisease),
).length;
if (bulkSaleCount <= 4_096) throw new Error("bulk-sale fixture no longer exceeds the trace cap");
const bulkSaleCheckpoint = JSON.stringify({
  version: 2,
  head: serializeGameAuthority(bulkSaleGame),
  history: [],
});
const otherRunCheckpoint = JSON.stringify({
  version: 2,
  head: serializeGameAuthority(createGameState(defaultGenOptions(15), 200, 0)),
  history: [],
});

function revealedOf(text: string | null): number {
  const match = /revealed\s+(\d+)\s*\/\s*\d+/.exec(text ?? "");
  if (!match) throw new Error(`could not parse revealed count from "${text}"`);
  return Number(match[1]);
}

async function canvasCell(canvas: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("factory canvas has no bounding box");
  return { x: box.x + 12 + x * 56 + 28, y: box.y + 12 + y * 56 + 28 };
}

async function unlock(page: Page, id: string): Promise<void> {
  await page.getByTestId("view-patents").click();
  await page.getByTestId(`patent-unlock-${id}`).click();
  if (id === "new-map" || id === "new-map-4") {
    await page.getByTestId(`patent-confirm-${id}`).click();
  }
  await expect(page.getByTestId(`patent-state-${id}`)).toHaveText("unlocked");
}

async function unlockRecipeMachines(page: Page, includeSkew = false): Promise<void> {
  await unlock(page, "bench-2");
  await unlock(page, "dilute-unlock");
  if (includeSkew) await unlock(page, "skew-unlock");
  await page.getByTestId("view-lab").click();
}

async function buildTemplate(page: Page, template: Template): Promise<void> {
  let rot: Rotation = 0;
  let flip = false;
  for (const machine of template.steps) {
    while (rot !== machine.orientation.rot) {
      await page.getByTestId("rotate").click();
      rot = ((rot + 1) % 4) as Rotation;
    }
    if (flip !== machine.orientation.flip) {
      await page.getByTestId("flip").click();
      flip = !flip;
    }
    await page.getByTestId(`palette-${machine.typeId}`).click();
  }
}

async function saveReferenceRecipe(page: Page): Promise<number> {
  await buildTemplate(page, reference);
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toContainText(/Run complete|WIN/i, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("save-recipe")).toBeVisible();
  await page.getByTestId("save-recipe").click();
  return referenceDisease;
}

async function stepFactory(page: Page, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) await page.getByTestId("factory-step").click();
}

test("unsafe cash and negative research query values fall back without crashing", async ({ page }) => {
  await page.goto("/?cash=1e100&research=-1");
  await expect(page.getByTestId("view-lab")).toBeVisible();
  await expect(page.getByTestId("cash")).toHaveText("200");
  await expect(page.getByTestId("research")).toHaveText("0");
});

test("Sell all dispatches one replayable bulk sale beyond the trace-entry cap", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
  }, bulkSaleCheckpoint);
  await page.goto("/");
  await page.getByTestId("load").click();
  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId(`shop-inv-${referenceDisease}`)).toHaveText(String(bulkSaleCount));

  await page.getByTestId(`shop-sell-all-${referenceDisease}`).click();

  await expect(page.getByTestId(`shop-inv-${referenceDisease}`)).toHaveText("0");
  await expect(page.getByTestId(`shop-sold-${referenceDisease}`)).toHaveText(String(bulkSaleCount));
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 1/i);
  expect(pageErrors).toEqual([]);
});

test("a source-to-sink factory cannot mint inventory for the saved recipe", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await unlockRecipeMachines(page);
  const disease = await saveReferenceRecipe(page);

  await page.getByTestId("preset-single").click();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  const machineCell = await canvasCell(canvas, 2, 0);
  await page.getByTestId("brush-erase").click();
  await page.mouse.click(machineCell.x, machineCell.y);
  await page.getByTestId("brush-belt").click();
  await page.mouse.click(machineCell.x, machineCell.y);
  await stepFactory(page, 20);
  await expect(page.getByTestId("factory-waste")).not.toHaveText("0");

  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId(`shop-inv-${disease}`)).toHaveText("0");
  await expect(page.getByTestId(`shop-sell-${disease}`)).toBeDisabled();
});

test("a failed sink output becomes waste instead of cure inventory", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await page.evaluate((blob) => localStorage.setItem("hexapharma.save.slot.0", blob), failedSave);
  await page.getByTestId("load").click();
  await page.getByTestId("view-factory").click();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await expect(page.getByTestId("factory-waste")).not.toHaveText("0");

  await page.getByTestId("view-shop").click();
  for (const disease of level.diseases) {
    await expect(page.getByTestId(`shop-inv-${disease.id}`)).toHaveText("0");
    await expect(page.getByTestId(`shop-sell-${disease.id}`)).toBeDisabled();
  }
});

test("a cured sink output that diverges from the saved recipe is counted as waste", async ({
  page,
}) => {
  await page.goto("/?cash=9999&research=9999");
  await page.evaluate((blob) => localStorage.setItem("hexapharma.save.slot.0", blob), divergentCureSave);
  await page.getByTestId("load").click();
  await page.getByTestId("view-factory").click();
  await expect(page.getByTestId("factory-recipe")).not.toContainText(/Producing the saved recipe/i);
  await expect(page.getByTestId("factory-recipe")).toContainText(/diverges/i);
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await expect(page.getByTestId("factory-waste")).not.toHaveText("0");

  await page.getByTestId("view-shop").click();
  for (const disease of level.diseases) {
    await expect(page.getByTestId(`shop-inv-${disease.id}`)).toHaveText("0");
  }
});

test("save/load restores recipe, inventory, fog, and factory layout and remains playable", async ({
  page,
}) => {
  await page.goto("/?cash=9999&research=9999");
  await unlockRecipeMachines(page);
  const disease = await saveReferenceRecipe(page);

  const savedRate = (await page.getByTestId("factory-rate").textContent())?.trim();
  const savedBottleneck = (await page.getByTestId("factory-bottleneck").textContent())?.trim();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  const savedProduced = Number((await page.getByTestId("factory-produced").textContent())?.trim());

  await page.getByTestId("view-shop").click();
  const savedInventory = Number((await page.getByTestId(`shop-inv-${disease}`).textContent())?.trim());
  expect(savedInventory).toBeGreaterThan(0);
  const savedCash = Number((await page.getByTestId("cash").textContent())?.trim());

  await page.getByTestId("view-lab").click();
  const revealed = page.getByTestId("revealed-count");
  const savedRevealed = revealedOf(await revealed.textContent());
  expect(savedRevealed).toBeGreaterThan(0);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved/i);

  await unlock(page, "reveal-aid");
  await page.getByTestId("view-lab").click();
  await expect
    .poll(async () => revealedOf(await revealed.textContent()))
    .toBeGreaterThan(savedRevealed);
  await page.getByTestId("view-factory").click();
  await page.getByTestId("preset-single").click();
  await expect(page.getByTestId("factory-rate")).not.toHaveText(savedRate ?? "");
  await page.getByTestId("view-shop").click();
  await page.getByTestId(`shop-sell-${disease}`).click();
  await expect(page.getByTestId(`shop-inv-${disease}`)).not.toHaveText(String(savedInventory));

  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Loaded/i);
  await expect(page.getByTestId("cash")).toHaveText(String(savedCash));

  await page.getByTestId("view-lab").click();
  await expect(revealed).toContainText(`revealed ${savedRevealed}/`);
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");
  await page.getByTestId("view-factory").click();
  await expect(page.getByTestId("factory-recipe")).toContainText(/saved recipe/i);
  await expect(page.getByTestId("factory-rate")).toHaveText(savedRate ?? "");
  await expect(page.getByTestId("factory-bottleneck")).toHaveText(savedBottleneck ?? "");
  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId(`shop-inv-${disease}`)).toHaveText(String(savedInventory));

  await page.getByTestId("view-factory").click();
  await page.getByTestId("factory-play").click();
  await expect
    .poll(async () => Number((await page.getByTestId("factory-produced").textContent())?.trim()), {
      timeout: 10_000,
    })
    .toBeGreaterThan(savedProduced);
  await page.getByTestId("factory-pause").click();
  await page.getByTestId("view-shop").click();
  await expect
    .poll(async () => Number((await page.getByTestId(`shop-inv-${disease}`).textContent())?.trim()))
    .toBeGreaterThan(savedInventory);
  await page.getByTestId(`shop-sell-${disease}`).click();
  await expect(page.getByTestId("cash")).not.toHaveText(String(savedCash));
});

test("loading a no-factory state while Factory is mounted does not resurrect the old layout", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();
  await page.getByTestId("preset-single").click();
  await expect(page.getByTestId("factory-bottleneck")).toContainText("pull");

  await page.evaluate((blob) => localStorage.setItem("hexapharma.save.slot.0", blob), freshNoFactorySave);
  await page.getByTestId("load").click();
  await expect(page.getByTestId("factory-bottleneck")).toContainText("push");
});

test("save slots and rewind history survive a page reload", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  const slot = page.getByTestId("save-slot");

  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 1/i);
  await slot.selectOption({ value: "1" });
  await expect(slot).toHaveValue("1");
  await expect(page.getByTestId("save-msg")).toHaveText("");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 2/i);
  await unlock(page, "reveal-aid");
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 2/i);

  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("cash")).toHaveText("9999");
  await expect(page.getByTestId("rewind")).toBeDisabled();
  await page.getByTestId("save-slot").selectOption({ value: "1" });
  await expect(page.getByTestId("save-msg")).toHaveText("");
  await expect(page.getByTestId("rewind")).toBeEnabled();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");

  await page.getByTestId("rewind").click();
  await expect(page.getByTestId("cash")).toHaveText("9999");
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");

  await page.reload();
  await page.getByTestId("save-slot").selectOption({ value: "1" });
  await page.getByTestId("load").click();
  await expect(page.getByTestId("cash")).toHaveText("9999");
  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");
});

test("saving over another run replaces its rewind timeline visibly", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.1", checkpoint);
  }, otherRunCheckpoint);
  await page.getByTestId("save-slot").selectOption({ value: "1" });
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/Replaced.*previous.*timeline/i);

  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("hexapharma.save.checkpoint.1");
    if (raw === null) throw new Error("missing replaced checkpoint");
    const checkpoint = JSON.parse(raw) as { head: string; history: string[] };
    const head = JSON.parse(checkpoint.head) as {
      authority: { origin: { genOptions: { seed: number } } };
    };
    return { seed: head.authority.origin.genOptions.seed, history: checkpoint.history.length };
  });
  expect(saved).toEqual({ seed: SEED, history: 0 });
});

test("corrupt save and history are reported without crashing or being replaced", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("hexapharma.save.history.0", "{broken history");
  });
  await page.reload();
  await expect(page.getByTestId("view-lab")).toBeVisible();
  await expect(page.getByTestId("save-msg")).toContainText(/history is invalid/i);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-msg")).toContainText(/history is invalid/i);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hexapharma.save.history.0")))
    .toBe("{broken history");

  await page.evaluate(() => {
    localStorage.removeItem("hexapharma.save.history.0");
    localStorage.setItem("hexapharma.save.slot.0", "{broken save");
  });
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/invalid save/i);
  await expect(page.getByTestId("cash")).toHaveText("200");
});

test("machine patents gate both palettes and expansion patents enlarge the factory", async ({
  page,
}) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("palette-skew")).toBeDisabled();

  await page.getByTestId("view-factory").click();
  await expect(page.getByTestId("brush-machine-skew")).toBeDisabled();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  const widthBefore = Number(await canvas.getAttribute("width"));

  await unlock(page, "bench-2");
  await unlock(page, "skew-unlock");
  await page.getByTestId("view-factory").click();
  const expandedCanvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(page.getByTestId("brush-machine-skew")).toBeEnabled();
  await expect
    .poll(async () => Number(await expandedCanvas.getAttribute("width")))
    .toBe(widthBefore + 2 * 56);
  await page.getByTestId("view-lab").click();
  await expect(page.getByTestId("palette-skew")).toBeEnabled();
});

test("the normal patent path progresses from two to three to four maps", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("map-count")).toHaveText("2 maps");

  await unlock(page, "bench-2");
  await unlock(page, "new-map");
  await page.getByTestId("view-lab").click();
  await expect(page.getByTestId("map-count")).toHaveText("3 maps", { timeout: 10_000 });

  await unlock(page, "new-map-4");
  await page.getByTestId("view-lab").click();
  await expect(page.getByTestId("map-count")).toHaveText("4 maps", { timeout: 10_000 });
});

test("a side-effect cure is sellable only with a non-zero side-effect penalty", async ({
  page,
}) => {
  await page.goto("/?cash=9999&research=9999");
  await unlockRecipeMachines(page, true);
  await buildTemplate(page, sideEffectTemplate);
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toContainText(
    new RegExp(
      `cured \\[${sideEffectDisease}\\].*side-effects \\[${sideEffectOutcome.sideEffects.join(", ")}\\]`,
      "i",
    ),
    { timeout: 10_000 },
  );
  await page.getByTestId("save-recipe").click();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();

  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId(`shop-inv-${sideEffectDisease}`)).not.toHaveText("0");
  const cashBefore = Number((await page.getByTestId("cash").textContent())?.trim());
  const gross = Number((await page.getByTestId(`shop-next-${sideEffectDisease}`).textContent())?.trim());
  await page.getByTestId(`shop-sell-${sideEffectDisease}`).click();
  const cashAfter = Number((await page.getByTestId("cash").textContent())?.trim());
  expect(cashAfter - cashBefore).toBeLessThan(gross - sideEffectProductionCost);
});
