import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";
import {
  DEMO_AGENT,
  SECOND_AGENT,
  gotoWithAgent,
  openAgentInfo,
  openAgentPanel,
  openFundAgent,
  selectAgent,
  setupOffline,
} from "./helpers";

test.describe("agent picker", () => {
  test("lists agents and auto-selects the first", async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] });
    await gotoWithAgent(page);
    const select = page.getByTestId("agent-select");
    await expect(select).toHaveAttribute("data-value", "demo");
    await openAgentPanel(page);
    await select.click();
    const options = page.getByTestId("agent-menu").getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(page.getByTestId("agent-option-demo")).toContainText("demo");
    await expect(page.getByTestId("agent-option-bravo")).toContainText("bravo");
    await expect(page.getByTestId("agent-create-option")).toContainText("Create agent");
  });

  test("lists agents with most recently used first", async ({ page }) => {
    const older = {
      ...DEMO_AGENT,
      lastActive: "2024-01-01T00:00:00.000Z",
      messageCount: 2,
      sessionCount: 1,
    };
    const newer = {
      ...SECOND_AGENT,
      lastActive: "2025-06-01T12:00:00.000Z",
      messageCount: 5,
      sessionCount: 2,
    };
    const never = { ...DEMO_AGENT, name: "zeta", agentId: "421614:99", lastActive: null };
    // API returns never-used / older first; UI should reorder latest → oldest → never.
    await setupOffline(page, { agents: [never, older, newer] });
    await page.goto("/");
    await openAgentPanel(page);
    await expect(page.getByTestId("agent-select")).toHaveAttribute("data-value", "bravo");
    await page.getByTestId("agent-select").click();
    const names = await page
      .getByTestId("agent-menu")
      .getByRole("option")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-agent-name")));
    expect(names).toEqual(["bravo", "demo", "zeta"]);
  });

  test("search filters agents by name and capability", async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] });
    await gotoWithAgent(page);
    await openAgentPanel(page);
    await page.getByTestId("agent-select").click();
    await page.getByTestId("agent-search").fill("send_eth");
    await expect(page.getByTestId("agent-option-demo")).toBeVisible();
    await expect(page.getByTestId("agent-option-bravo")).toHaveCount(0);
    await page.getByTestId("agent-search").fill("nothing-matches");
    await expect(page.getByText(/No agents match/)).toBeVisible();
    await expect(page.getByTestId("agent-create-option")).toBeVisible();
  });

  test("shows an error banner when the agents API is down", async ({ page }) => {
    await setupOffline(page, {
      agentsStatus: 500,
      agentsError: "API unavailable — run npm run serve",
    });
    await page.goto("/");
    await openAgentPanel(page);
    await expect(page.getByTestId("agent-select")).toBeVisible();
    await openAgentInfo(page);
    await expect(page.getByTestId("picker-error")).toContainText("API unavailable");
  });

  test("shows empty state when no agents exist", async ({ page }) => {
    await setupOffline(page, { agents: [] });
    await page.goto("/");
    await openAgentPanel(page);
    await expect(page.getByTestId("agent-select")).toBeVisible();
    await expect(page.getByTestId("agent-select")).toContainText("Create your first agent");
    await openAgentInfo(page);
    await expect(page.getByText("No agents yet")).toBeVisible();
  });

  test("Agent Info section collapses and expands", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openAgentPanel(page);
    const toggle = page.getByRole("button", { name: /Agent Info/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("agent-rating")).toBeVisible();
    await expect(page.getByTestId("fund-amount")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("reloads the agent list automatically when the select opens", async ({ page }) => {
    let calls = 0;
    await setupOffline(page, { agents: [DEMO_AGENT] });
    await page.route("**/api/health", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          network: "arbitrum-sepolia",
          chainId: 421614,
          master: {},
        }),
      });
    });
    await page.route("**/api/agents**", async (route: Route) => {
      calls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agents: [DEMO_AGENT] }),
      });
    });
    await gotoWithAgent(page);
    await openAgentPanel(page);
    await page.getByTestId("agent-select").click();
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
    // refresh keeps the selection and shows no error
    await expect(page.getByTestId("agent-select")).toHaveAttribute("data-value", "demo");
    await page.keyboard.press("Escape");
    await openAgentInfo(page);
    await expect(page.getByTestId("picker-error")).toHaveCount(0);
  });

  test("rating line shows mappings for 0 / 1 / N ratings", async ({ page }) => {
    // 0 ratings
    await setupOffline(page, {
      reputation: { agentId: "421614:42", count: 0, averageValue: 0 },
    });
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await expect(page.getByTestId("agent-rating")).toContainText("No ratings yet");

    // 1 rating
    await setupOffline(page, {
      reputation: { agentId: "421614:42", count: 1, averageValue: 80 },
    });
    await page.goto("/");
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await expect(page.getByTestId("agent-rating")).toContainText("1 rating");
    await expect(page.getByTestId("agent-rating")).not.toContainText("ratings");

    // N ratings
    await setupOffline(page, {
      reputation: { agentId: "421614:42", count: 12, averageValue: 92.34 },
    });
    await page.goto("/");
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await expect(page.getByTestId("agent-rating")).toContainText("92.3/100");
    await expect(page.getByTestId("agent-rating")).toContainText("12 ratings");
  });

  test("rating line stays blank when reputation lookup fails", async ({ page }) => {
    await setupOffline(page, { reputation: null });
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await expect(page.getByTestId("agent-rating")).toContainText("—");
  });
});

test.describe("fund agent", () => {
  test("Fund Agent section collapses and expands", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openAgentPanel(page);
    const toggle = page.getByRole("button", { name: /Fund Agent/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("fund-amount")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("fund-amount")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("fund-amount")).toBeHidden();
  });

  test("validates amount: only (0, 1] enables Send", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openFundAgent(page);
    const amount = page.getByTestId("fund-amount");
    const submit = page.getByTestId("fund-submit");
    await expect(submit).toBeEnabled(); // default 0.001

    await amount.fill("0");
    await expect(submit).toBeDisabled();
    await amount.fill("2");
    await expect(submit).toBeDisabled();
    await amount.fill("-0.1");
    await expect(submit).toBeDisabled();
    await amount.fill("abc");
    await expect(submit).toBeDisabled();
    await amount.fill("0.001");
    await expect(submit).toBeEnabled();
  });

  test("successful fund shows tx prefix status", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openFundAgent(page);
    await expect(page.getByText("Connected wallet")).toBeVisible();
    await page.getByTestId("fund-amount").fill("0.001");
    await page.getByTestId("fund-submit").click();
    // setupOffline stubs __E2E_SEND_TX → 0xdddd…
    await expect(page.getByTestId("fund-status")).toContainText("Sent 0xdddddd");
  });

  test("fund error surfaces not-enough-funds mapping", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openFundAgent(page);
    await page.evaluate(() => {
      (window as unknown as { __E2E_SEND_TX?: () => never }).__E2E_SEND_TX = () => {
        throw new Error(
          "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.",
        );
      };
    });
    await page.getByTestId("fund-amount").fill("0.001");
    await page.getByTestId("fund-submit").click();
    await expect(page.getByTestId("fund-status")).toContainText("not enough funds");
  });

  test("maps RPC rate-limit errors to a friendly retry hint", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openFundAgent(page);
    await page.evaluate(() => {
      (window as unknown as { __E2E_SEND_TX?: () => never }).__E2E_SEND_TX = () => {
        throw new Error("exceeds defined limit -32005 rate limited");
      };
    });
    await page.getByTestId("fund-amount").fill("0.001");
    await page.getByTestId("fund-submit").click();
    await expect(page.getByTestId("fund-status")).toContainText("RPC rate limit hit");
  });
});

test.describe("delete agent", () => {
  test("first click asks for confirmation, second deletes", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await page.getByTestId("picker-delete").click();
    await expect(page.getByTestId("delete-status")).toContainText("Click Delete again to confirm");
    await expect(page.getByTestId("picker-delete")).toContainText("Confirm delete");

    await page.getByTestId("picker-delete").click();
    // success clears selection -> chat shows the no-agent prompt
    await expect(page.getByTestId("chat-empty-no-agent")).toBeVisible({ timeout: 15000 });
  });

  test("delete error keeps the agent and shows the message", async ({ page }) => {
    await setupOffline(page, { deleteStatus: 500 });
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await page.getByTestId("picker-delete").click();
    await page.getByTestId("picker-delete").click();
    await expect(page.getByTestId("delete-status")).toContainText("delete failed");
    await expect(page.getByTestId("agent-select")).toHaveAttribute("data-value", "demo");
  });

  test("switching selection resets a stale delete confirmation", async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] });
    await gotoWithAgent(page);
    await openAgentInfo(page);
    await page.getByTestId("picker-delete").click();
    await expect(page.getByTestId("delete-status")).toContainText("Click Delete again");
    await selectAgent(page, "bravo");
    await expect(page.getByTestId("picker-delete")).toContainText("Delete");
    await expect(page.getByTestId("delete-status")).toHaveCount(0);
  });
});
