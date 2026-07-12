import { test, expect, type Page } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

const analysisOptions = defaultGenOptions(14);
const analysisRecipe = generate(analysisOptions).diseases[0]!.reference;
let analysisGame = createGameState(analysisOptions, 200, 0);
analysisGame = applyGameIntent(analysisGame, {
  kind: "saveRecipe",
  recipe: analysisRecipe,
  factory: compileEntitledPrototype(
    analysisRecipe,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout,
});
const analysisBelt = analysisGame.factory!.tiles.findIndex((tile) => tile.kind === "belt");
if (analysisBelt < 0) throw new Error("analysis fixture has no belt to erase");
const analysisSave = serializeGame(analysisGame);

/** Parse the "num/den" throughput rate shown in the status bar into a number. */
async function rate(page: Page): Promise<number> {
  const txt = (await page.getByTestId("factory-rate").textContent())?.trim() ?? "0";
  const m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(txt);
  if (!m) return Number(txt);
  return Number(m[1]) / Number(m[2]);
}

test("HexaPharma Factory runs the belt sim and produces units", async ({ page }) => {
  await page.goto("/");

  // Switch to the Factory view.
  await page.getByTestId("view-factory").click();

  // Heading + canvas + run controls present.
  await expect(page.getByRole("heading", { name: /HexaPharma Factory/i })).toBeVisible();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("factory-play")).toBeVisible();
  await expect(page.getByTestId("factory-step")).toBeVisible();
  await expect(page.getByTestId("factory-reset")).toBeVisible();

  // The default line reports a real machine bottleneck (id + type) and a rate.
  await expect(page.getByTestId("factory-bottleneck")).toContainText(/#\d+\s*\(/);
  await expect(page.getByTestId("factory-rate")).toHaveText(/^\d+\/\d+$/);

  const tick = page.getByTestId("factory-tick");
  await expect(tick).toHaveText("0");

  // Step several times: the tick counter advances.
  for (let i = 0; i < 6; i++) await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("6");

  // Play advances the sim on a timer; a unit reaches the sink and produced climbs.
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();

  // Reset returns the tick to 0.
  await page.getByTestId("factory-reset").click();
  await expect(tick).toHaveText("0");

  await page.screenshot({ path: "test/e2e/__screenshots__/factory.png", fullPage: true });
  await expect(page).toHaveScreenshot("factory-reset.png", {
    fullPage: true,
    animations: "disabled",
  });
});

test("a divergent factory reports bounded-analysis errors without crashing React", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await page.evaluate((blob) => localStorage.setItem("hexapharma.save.slot.0", blob), analysisSave);
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-factory").click();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  const width = analysisGame.factory!.width;
  const x = analysisBelt % width;
  const y = Math.floor(analysisBelt / width);
  await page.getByTestId("brush-erase").click();
  await canvas.click({ position: { x: 12 + x * 42 + 21, y: 12 + y * 42 + 21 } });

  await expect(page.getByTestId("factory-analysis-error")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("real parallelism: splitter→two machines→merger out-produces a single machine", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  // Load the SINGLE-machine preset (one catalog-speed pull) and read its steady rate.
  await page.getByTestId("preset-single").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  const single = await rate(page);
  expect(single).toBeGreaterThan(0);

  // Single preset is machine-limited: one machine is the bottleneck.
  await expect(page.getByTestId("factory-bottleneck")).toContainText(/#\d+\s*\(/);

  // Load the PARALLEL preset (splitter → two machines → merger) and read its rate.
  await page.getByTestId("preset-parallel").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  const parallel = await rate(page);

  // Real parallelism: two machines on the same feed beat one (~2×, MEASURED by the sim).
  expect(parallel).toBeGreaterThan(single * 1.5);

  // And the parallel layout actually produces units when run.
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
});

test("Factory editing places a machine + a tile via the palette", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-factory").click();

  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  // Cell center math mirrors the renderer: PAD=12, CELL=42 → center = 12 + c*42 + 21.
  const center = (c: number) => 12 + c * 42 + 21;

  // Select a machine type and rotate its drug effect independently from its footprint.
  await page.getByTestId("brush-machine-pull").click();
  await expect(page.getByTestId("brush-selected")).toContainText("pull");
  await page.getByTestId("brush-effect-rotate").click();
  await expect(page.getByTestId("brush-effect-rotate")).toContainText("effect 90°");
  await page.getByTestId("brush-footrot").click();
  await expect(page.getByTestId("brush-footrot")).toContainText("foot 90°");
  // Click an empty cell on a lower row to place the machine (added to layout.machines).
  await canvas.click({ position: { x: center(3), y: center(3) } });
  // Editing re-inits the sim → tick resets to 0.
  await expect(page.getByTestId("factory-tick")).toHaveText("0");

  // Place a belt tile too (direction toggle works for tiles).
  await page.getByTestId("brush-belt").click();
  await page.getByTestId("brush-rotate").click(); // → S
  await expect(page.getByTestId("brush-direction")).toContainText("S");
  await canvas.click({ position: { x: center(4), y: center(3) } });
  await expect(page.getByTestId("factory-tick")).toHaveText("0");

  // The sim still steps after edits (no crash; counter advances).
  await page.getByTestId("factory-step").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("1");

  await page.getByTestId("save").click();
  const savedMachines = await page.evaluate(() => {
    const raw = localStorage.getItem("hexapharma.save.checkpoint.0");
    if (raw === null) throw new Error("missing checkpoint");
    const checkpoint = JSON.parse(raw) as { head: string };
    const saved = JSON.parse(checkpoint.head) as {
      authority: {
        intentTrace: Array<{
          kind: string;
          factory?: { machines: Array<{ anchor: { x: number; y: number }; def: { orientation: unknown } }> };
        }>;
      };
    };
    let layoutIntent: (typeof saved.authority.intentTrace)[number] | undefined;
    for (let index = saved.authority.intentTrace.length - 1; index >= 0; index--) {
      const intent = saved.authority.intentTrace[index];
      if (intent?.kind === "setFactory") {
        layoutIntent = intent;
        break;
      }
    }
    if (layoutIntent?.factory === undefined) throw new Error("saved authority has no factory layout");
    return layoutIntent.factory.machines;
  });
  expect(savedMachines.find((machine) => machine.anchor.y > 0)?.def.orientation).toEqual({ rot: 1, flip: false });
});
