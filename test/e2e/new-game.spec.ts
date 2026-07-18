import { expect, test } from "@playwright/test";

test("a player can start a different seeded run without deleting saved checkpoints", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("seed")).toHaveText("14");
  await page.getByTestId("save").click();
  await page.getByTestId("view-blueprints").click();
  await page.getByTestId("blueprint-name").fill("Cross-seed floor");
  await page.getByTestId("blueprint-save-production").click();
  await expect(page.getByTestId("blueprint-library")).toContainText("Cross-seed floor");
  await page.keyboard.press("Escape");

  const trigger = page.getByTestId("new-game");
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: "Start new game?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Seed")).toHaveValue("15");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("seed")).toHaveText("14");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByLabel("Seed").fill("16");
  await dialog.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("seed")).toHaveText("16");
  await expect(page.getByTestId("cash")).toHaveText("1000");
  await expect(page.getByTestId("research")).toHaveText("0");
  await page.getByTestId("view-blueprints").click();
  await expect(page.getByTestId("blueprint-library")).toContainText("Cross-seed floor");
  await page.keyboard.press("Escape");

  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" })
    .getByRole("button", { name: "Load" })
    .click();
  await expect(page.getByTestId("seed")).toHaveText("14");
});

test("new-game validation and confirmation freeze the background", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  const dialog = page.getByRole("alertdialog", { name: "Start new game?" });
  const seed = dialog.getByLabel("Seed");
  const start = dialog.getByRole("button", { name: "Start" });

  await seed.fill("4294967296");
  await expect(start).toBeDisabled();
  await expect(dialog).toContainText("0 to 4294967295");
  await seed.fill("17");
  await expect(start).toBeEnabled();
  await page.keyboard.press("F2");
  await page.keyboard.press("m");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("view-research")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("market-drawer")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("new-game")).toBeFocused();
  await expect(page.getByTestId("seed")).toHaveText("14");
});
