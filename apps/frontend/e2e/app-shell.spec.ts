import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";
import {
  gotoWithAgent,
  openAgentPanel,
  openConversations,
  openCreateDialog,
  setupOffline,
} from "./helpers";

test.describe("app shell", () => {
  test("brand header + sign-in CTA render when disconnected", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await expect(page.getByText("Web3 Agent Chat")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
  });

  test("agent drawer covers the conversations button on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openAgentPanel(page);

    const covered = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Conversations"),
      );
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest("#agent-panel");
    });
    expect(covered).toBe(true);

    const toggleHit = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="agent-panel-toggle"]');
      if (!toggle) return false;
      const r = toggle.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="agent-panel-toggle"]');
    });
    expect(toggleHit).toBe(true);
  });

  test("conversations drawer toggles aria-expanded + visibility", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    const btn = page.getByRole("button", { name: /Conversations/ });
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("agent-memory")).toBeVisible();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  test("create dialog opens via picker and closes via X", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await expect(page.getByTestId("create-dialog")).toContainText("Create agent");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("create-dialog")).toHaveCount(0);
  });

  test("Escape closes the create dialog", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-dialog")).toHaveCount(0);
  });

  test("backdrop click closes the create dialog", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);
    // click top-left of the backdrop (outside the dialog card)
    await page.locator(".dialog-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("create-dialog")).toHaveCount(0);
  });

  test("full chat route is reachable after selecting an agent", async ({ page }) => {
    await setupOffline(page, {
      chat: { reply: "pong", events: [{ type: "message", content: "pong" }] },
    });
    await gotoWithAgent(page);
    await openConversations(page); // drawer works alongside chat
    await page.getByTestId("chat-input").fill("ping");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-bubble-agent").first()).toContainText("pong");
  });

  test("4xx chat error for unknown agent surfaces cleanly", async ({ page }) => {
    await setupOffline(page, {
      chat: async (route: Route) => {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Agent not found" }),
        });
      },
    });
    await gotoWithAgent(page);
    await page.getByTestId("chat-input").fill("ghost");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-bubble-error").first()).toContainText("Agent not found");
  });

  test("page has no console errors on clean load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await expect(page.getByTestId("chat-thread")).toBeVisible();
    expect(errors.filter((e) => !e.includes("ethereum") && !e.includes("MetaMask"))).toEqual([]);
  });
});
