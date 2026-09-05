import type { Page } from "@playwright/test";

export async function openMenu(page: Page): Promise<void> {
  if (!await page.getByTestId("menu-drawer").isVisible()) await page.getByTestId("view-menu").click();
}
