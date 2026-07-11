import { expect, test } from "@playwright/test";
import { createGameState } from "../../src/sim/game";
import { serializeGameAuthority } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";

const maximumGameMap = createGameState(
  { ...defaultGenOptions(14, 4), width: 64, height: 64 },
  200,
  0,
);
const maximumGameMapCheckpoint = JSON.stringify({
  version: 2,
  head: serializeGameAuthority(maximumGameMap),
  history: [],
});
const maximumTwoMapCheckpoint = JSON.stringify({
  version: 2,
  head: serializeGameAuthority(createGameState(
    { ...defaultGenOptions(14, 2), width: 64, height: 64 },
    200,
    0,
  )),
  history: [],
});

test("production preview loads every lazy UI surface without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("[data-testid='lab-canvas'] canvas")).toBeVisible();
  await expect(page.getByTestId("lab-render-error")).toHaveCount(0);

  await page.getByTestId("view-factory").click();
  await expect(page.locator("[data-testid='factory-canvas'] canvas")).toBeVisible();
  await expect(page.getByTestId("factory-render-error")).toHaveCount(0);

  await page.getByTestId("view-shop").click();
  await expect(page.getByTestId("shop-table")).toBeVisible();

  await page.getByTestId("view-patents").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();

  expect(errors).toEqual([]);
});

test("production preview renders the maximum Game-authorized map dimensions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
  }, maximumGameMapCheckpoint);
  await page.reload();
  await page.getByTestId("load").click();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("lab-render-error")).toHaveCount(0);
  const size = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  expect(size.width).toBe(704);
  expect(size.height).toBe(512);
  expect(errors).toEqual([]);
});

test("the widest maximum Game map stays inside the Lab content width", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
  }, maximumTwoMapCheckpoint);
  await page.reload();
  await page.getByTestId("load").click();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBe(704);
});
