import { expect, test } from "@playwright/test";
import { createGameState } from "../../src/sim/game";
import { LAB_VIEWPORT } from "../../src/render/labCamera";
import { serializeGameAuthority } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";

const maximumGameMap = createGameState(
  { ...defaultGenOptions(14), width: 64, height: 64 },
  200,
  0,
);
const maximumGameMapCheckpoint = JSON.stringify({
  version: 2,
  head: serializeGameAuthority(maximumGameMap),
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
  await expect(page.getByTestId("research-path-hotbar")).toBeVisible();
  await expect(page.getByTestId("research-workspace").getByTestId("factory-canvas")).toHaveCount(0);

  await page.getByTestId("view-pilot").click();
  await expect(page.locator("[data-testid='factory-canvas'] canvas").last()).toBeVisible();
  await expect(page.getByTestId("factory-render-error")).toHaveCount(0);

  await page.getByTestId("view-production").click();
  await expect(page.getByTestId("production-uncommissioned")).toBeVisible();

  await page.getByTestId("view-market").click();
  await expect(page.getByTestId("shop-table")).toBeVisible();

  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patents-table")).toBeVisible();

  await page.getByTestId("view-blueprints").click();
  await expect(page.getByTestId("blueprint-library")).toBeVisible();

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
  expect(size).toEqual(LAB_VIEWPORT);
  expect(errors).toEqual([]);
});

test("the maximum Game map stays inside the Atlas content width", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
  }, maximumGameMapCheckpoint);
  await page.reload();
  await page.getByTestId("load").click();
  const canvas = page.locator("[data-testid='lab-canvas'] canvas");
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  const frameBox = await page.getByTestId("lab-map-frame").boundingBox();
  if (canvasBox === null || frameBox === null) throw new Error("Atlas canvas has no bounds");
  expect(canvasBox.width).toBeLessThanOrEqual(frameBox.width + 1);
  expect(canvasBox.height).toBeLessThanOrEqual(frameBox.height + 1);
});
