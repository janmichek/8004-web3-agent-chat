import { test, expect } from "@playwright/test";
import { setupOffline } from "./helpers";

test.describe("wallet bar (Web3Auth sign-in)", () => {
  test("disconnected state shows the sign-in CTA and no address", async ({ page }) => {
    await setupOffline(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("header .addr")).toHaveCount(0);
    await expect(page.locator("header .balance")).toHaveCount(0);
    await expect(page.getByTestId("theme-toggle")).toHaveCount(0);
  });

  test("sign-in CTA is enabled and opens the Web3Auth modal when disconnected", async ({
    page,
  }) => {
    await setupOffline(page);
    await page.goto("/");
    const btn = page.getByRole("button", { name: "Sign in" });
    // Wait for Web3Auth modal init (needs absolute https rpcTarget).
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    await btn.click();
    // The header button leaves the a11y tree while the third-party modal is open,
    // so assert the modal itself (same visible option the fund panel test uses).
    await expect(
      page.locator("#w3a-parent-container").getByText("Continue with Email/Phone"),
    ).toBeVisible();
  });
});
