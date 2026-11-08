import { test, expect, type Page } from "@playwright/test";
import { DEMO_AGENT, MOCK_CATALOG, gotoWithAgent, openCreateDialog, setupOffline } from "./helpers";

async function toConfigure(page: import("@playwright/test").Page) {
  await openCreateDialog(page);
  await page.getByTestId("create-name-input").fill("my-agent");
  await page.getByTestId("create-name-continue").click();
  await page.getByTestId("create-connections-continue").click();
  await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();
}

test.describe("create agent wizard", () => {
  test("shows environment + validates agent name", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);
    // env from catalog
    await expect(page.getByTestId("create-dialog")).toContainText("Arbitrum Sepolia");
    // the signed-in wallet is the owner
    await expect(page.getByTestId("create-owner-address")).toHaveText(
      "0x9999999999999999999999999999999999999999",
    );
    // the app's signer is the creator
    await expect(page.getByTestId("create-creator-address")).toHaveText(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    const input = page.getByTestId("create-name-input");
    const next = page.getByTestId("create-name-continue");
    await expect(next).toBeDisabled(); // empty
    await input.fill("-bad start");
    await expect(next).toBeDisabled();
    await input.fill("a".repeat(64));
    await expect(next).toBeDisabled();
    await input.fill("good-name_1.x");
    await expect(next).toBeEnabled();
    // Enter key advances to the connections step
    await input.press("Enter");
    await expect(page.getByTestId("create-web-endpoint")).toBeVisible();
  });

  test("shows a banner when catalog fails to load", async ({ page }) => {
    await setupOffline(page, { catalogStatus: 500 });
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await expect(page.getByTestId("create-load-error")).toContainText("catalog boom");
  });

  test("identity card shows the network as a select while the catalog loads", async ({ page }) => {
    await setupOffline(page, {});
    // Slow catalog: the card must still render the compact select, not a chip.
    await page.route("**/api/catalog", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_CATALOG),
      });
    });
    await gotoWithAgent(page);
    await openCreateDialog(page);
    const select = page.getByTestId("create-network");
    await expect(select).toBeVisible();
    await expect(page.locator('[data-testid="agent-card-network"].issued-chip')).toHaveCount(0);
  });

  test("an action is mutually exclusive with the tools it bundles", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await toConfigure(page);

    const bundles = [
      { action: "transfer-eth", tools: ["send_eth", "get_token_balance"] },
      {
        action: "ens-name",
        tools: ["resolve_ens", "lookup_ens", "register_ens", "set_primary_ens"],
      },
    ];

    for (const bundle of bundles) {
      const actionBox = page.getByTestId(`create-action-${bundle.action}`);
      const actionLabel = page.locator("label", { has: actionBox });
      const toolBoxes = bundle.tools.map((name) => page.getByTestId(`create-tool-${name}`));
      const unrelated = page.getByTestId("create-tool-fetch_contract_abi");

      await toolBoxes[0].check();
      await expect(actionBox).toBeDisabled();
      await expect(actionLabel).toHaveClass(/disabled/);
      await expect(unrelated).toBeEnabled();

      await toolBoxes[0].uncheck();
      await expect(actionBox).toBeEnabled();

      await actionBox.check();
      for (const box of toolBoxes) {
        await expect(box).not.toBeChecked();
        await expect(box).toBeDisabled();
      }
      await expect(unrelated).toBeEnabled();
      await expect(unrelated).not.toBeChecked();

      await actionBox.uncheck();
      for (const box of toolBoxes) await expect(box).toBeEnabled();
    }
  });

  test("completes the wizard and opens chat for the new agent", async ({ page }) => {
    const created: unknown[] = [];
    const newAgent = { ...DEMO_AGENT, name: "fresh-agent" };
    await setupOffline(page, {
      capture: { create: created },
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: "0.002",
      },
    });
    await gotoWithAgent(page);
    await toConfigure(page);
    await page.getByTestId("create-action-transfer-eth").check();
    await page.getByRole("button", { name: "Next →" }).last().click(); // configure -> oasf
    await expect(page.getByTestId("create-oasf-domain-6")).toBeVisible();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("create-dialog")).toContainText("fresh-agent");
    await expect(page.getByTestId("create-dialog")).toContainText("wallet");
    // funding now lives on the done step
    await expect(page.getByTestId("create-fund-panel")).toBeVisible();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "my-agent" });
    // MCP + A2A are prefilled as ${origin}/api/{mcp,a2a}; A2A is scoped to the agent name
    expect(created[0]).toMatchObject({
      services: expect.arrayContaining([
        { name: "web", endpoint: "https://example.com" },
        { name: "email", endpoint: "e@mail.fun" },
        { name: "mcp", endpoint: expect.stringMatching(/\/api\/mcp$/) },
        { name: "A2A", endpoint: expect.stringMatching(/\/api\/a2a\?agent=my-agent$/) },
      ]),
    });

    await page.getByRole("button", { name: "Open chat" }).click();
    await expect(page.getByTestId("create-dialog")).toHaveCount(0);
    // wizard selected the new agent in the picker
    await expect(page.getByTestId("agent-select")).toHaveAttribute("data-value", "fresh-agent", {
      timeout: 15000,
    });
  });

  test("creates the agent on the picked network and links its explorer", async ({ page }) => {
    const created: unknown[] = [];
    const newAgent = {
      ...DEMO_AGENT,
      name: "fresh-agent",
      walletChainId: 11155111,
      agentId: "11155111:7",
    };
    await setupOffline(page, {
      capture: { create: created },
      create: { ok: true, agent: newAgent, balanceEth: "0" },
    });
    await gotoWithAgent(page);
    await openCreateDialog(page);

    // defaults to the server's network; switcher picks the create chain
    const network = page.getByTestId("create-network");
    await expect(network).toHaveAttribute("data-value", "421614");
    await network.click();
    await page.getByTestId("create-network-option-11155111").click();
    await expect(network).toHaveAttribute("data-value", "11155111");

    await page.getByTestId("create-name-input").fill("my-agent");
    await page.getByTestId("create-name-continue").click();
    await page.getByTestId("create-connections-continue").click();
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });

    expect(created[0]).toMatchObject({ name: "my-agent", chainId: 11155111 });
    const dialog = page.getByTestId("create-dialog");
    await expect(page.getByTestId("agent-card-network")).toContainText("Ethereum Sepolia");
    await expect(dialog.locator('a[href*="sepolia.etherscan.io/address/0x1111"]')).toBeVisible();
    await expect(dialog.locator('a[href*="8004scan.io/agents/sepolia/7"]')).toBeVisible();
  });

  test("post-creation fund amount validation gates funding", async ({ page }) => {
    const newAgent = { ...DEMO_AGENT, name: "fresh-agent" };
    await setupOffline(page, {
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: "0",
      },
    });
    await gotoWithAgent(page);
    await toConfigure(page);
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    const fundInput = page.getByTestId("create-fund-amount");
    const masterBtn = page.getByTestId("create-fund-master");
    const walletBtn = page.getByTestId("create-fund-wallet");
    await expect(masterBtn).toBeEnabled();
    await expect(walletBtn).toBeEnabled();
    await fundInput.fill("99");
    await expect(masterBtn).toBeDisabled();
    await expect(walletBtn).toBeDisabled();
    await fundInput.fill("-1");
    await expect(masterBtn).toBeDisabled();
    await fundInput.fill("abc");
    await expect(masterBtn).toBeDisabled();
    await fundInput.fill("0");
    await expect(masterBtn).toBeDisabled(); // 0 = nothing to fund
    await fundInput.fill("0.001");
    await expect(masterBtn).toBeEnabled();
  });

  test("post-creation master-wallet funding shows tx status", async ({ page }) => {
    const newAgent = { ...DEMO_AGENT, name: "fresh-agent" };
    const funded: unknown[] = [];
    await setupOffline(page, {
      capture: { fund: funded },
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: "0",
      },
      fund: {
        ok: true,
        txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        amountEth: "0.001",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    await gotoWithAgent(page);
    await toConfigure(page);
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("create-fund-currency")).toContainText("ETH");
    await expect(page.getByTestId("create-fund-network")).toBeVisible();
    await page.getByTestId("create-fund-amount").fill("0.001");
    await page.getByTestId("create-fund-master").click();
    await expect(page.getByTestId("create-fund-wallet")).toHaveText("Add more");
    await expect(page.getByTestId("create-fund-status")).toHaveCount(0);
    await expect(page.getByTestId("create-fund-tx-link")).toHaveAttribute("href", /\/tx\/0xeeeeee/);
    expect(funded).toHaveLength(1);
  });

  test("creation failure shows error screen with Back + Retry", async ({ page }) => {
    await setupOffline(page, { createStatus: 409 });
    await gotoWithAgent(page);
    await toConfigure(page);
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Creation failed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("create-dialog")).toContainText("already exists");
    // Back returns to the OASF step
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByTestId("create-oasf-domain-6")).toBeVisible();
  });

  test("Back buttons navigate configure <-> oasf <-> connections <-> identity", async ({
    page,
  }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await toConfigure(page);
    await page.getByRole("button", { name: "Next →" }).last().click();
    await expect(page.getByTestId("create-oasf-domain-6")).toBeVisible();
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByTestId("create-web-endpoint")).toBeVisible();
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByTestId("create-name-input")).toBeVisible();
  });

  test("connections step sends prefilled web/email services with creation", async ({ page }) => {
    const created: unknown[] = [];
    await setupOffline(page, { capture: { create: created } });
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await page.getByTestId("create-name-input").fill("my-agent");
    await page.getByTestId("create-name-continue").click();
    await expect(page.getByTestId("create-web-endpoint")).toHaveValue("https://example.com");
    await expect(page.getByTestId("create-email-endpoint")).toHaveValue("e@mail.fun");
    // MCP/A2A are prefilled — clear them to test web/email-only payload
    await expect(page.getByTestId("create-mcp-endpoint")).toHaveValue(/\/api\/mcp$/);
    await expect(page.getByTestId("create-a2a-endpoint")).toHaveValue(
      /\/api\/a2a\?agent=my-agent$/,
    );
    await page.getByTestId("create-mcp-endpoint").fill("");
    await page.getByTestId("create-a2a-endpoint").fill("");
    await page.getByTestId("create-connections-continue").click();
    await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    expect(created[0]).toMatchObject({
      services: [
        { name: "web", endpoint: "https://example.com" },
        { name: "email", endpoint: "e@mail.fun" },
      ],
    });
  });

  test("mcp and a2a endpoints are advertised as services when set", async ({ page }) => {
    const created: unknown[] = [];
    await setupOffline(page, { capture: { create: created } });
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await page.getByTestId("create-name-input").fill("my-agent");
    await page.getByTestId("create-name-continue").click();
    // MCP/A2A are prefilled — verify then override with custom hosts
    await expect(page.getByTestId("create-mcp-endpoint")).toHaveValue(/\/api\/mcp$/);
    await expect(page.getByTestId("create-a2a-endpoint")).toHaveValue(
      /\/api\/a2a\?agent=my-agent$/,
    );
    await page.getByTestId("create-mcp-endpoint").fill("https://my-host/mcp");
    await page.getByTestId("create-a2a-endpoint").fill("https://my-host/api/a2a");
    await page.getByTestId("create-connections-continue").click();
    await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();
    await page.getByTestId("create-action-transfer-eth").check();
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    expect(created[0]).toMatchObject({
      services: [
        { name: "web", endpoint: "https://example.com" },
        { name: "email", endpoint: "e@mail.fun" },
        { name: "mcp", endpoint: "https://my-host/mcp" },
        { name: "A2A", endpoint: "https://my-host/api/a2a" },
      ],
    });
  });

  test("a2a endpoint follows the agent name until edited; x402 is opt-in in test mode", async ({
    page,
  }) => {
    const created: unknown[] = [];
    await setupOffline(page, { capture: { create: created } });
    await gotoWithAgent(page);
    await openCreateDialog(page);
    const a2a = page.getByTestId("create-a2a-endpoint");
    const x402 = page.getByTestId("create-x402");

    await page.getByTestId("create-name-input").fill("my-agent");
    await page.getByTestId("create-name-continue").click();
    await expect(a2a).toHaveValue(/\/api\/a2a\?agent=my-agent$/);
    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByTestId("create-name-input").fill("renamed");
    await page.getByTestId("create-name-continue").click();
    await expect(a2a).toHaveValue(/\/api\/a2a\?agent=renamed$/);

    // No facilitator in the mocked catalog → off by default, with the reason shown.
    await expect(x402).not.toBeChecked();
    await expect(page.getByTestId("create-x402-hint")).toContainText("payments are simulated");

    // Without an A2A endpoint x402 cannot be on.
    await a2a.fill("");
    await expect(x402).toBeDisabled();
    await a2a.fill("https://my-host/api/a2a");
    await x402.check();

    await page.getByTestId("create-connections-continue").click();
    await page.getByRole("button", { name: "Next →" }).last().click();
    await page.getByTestId("create-dialog").getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15000 });
    expect(created[0]).toMatchObject({ name: "renamed", x402support: true });
    expect(created[0]).toMatchObject({
      services: expect.arrayContaining([{ name: "A2A", endpoint: "https://my-host/api/a2a" }]),
    });
  });

  test("warns when tools selected but no mcp endpoint set", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);
    await page.getByTestId("create-name-input").fill("my-agent");
    await page.getByTestId("create-name-continue").click();
    // Clear prefilled MCP to trigger missing-endpoint warning
    await page.getByTestId("create-mcp-endpoint").fill("");
    await page.getByTestId("create-connections-continue").click();
    await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();
    await page.getByTestId("create-action-transfer-eth").check();
    await expect(page.getByTestId("create-mcp-warning-configure")).toContainText("No MCP endpoint");
  });
});

test.describe("create agent — step 1 image & description", () => {
  function randomCid(): string {
    return `bafkrei${Math.random().toString(36).slice(2, 14)}`;
  }

  /** Mock POST /api/upload/image (not covered by setupOffline) → ipfs://<cid>. */
  async function mockUploadImage(
    page: Page,
    cid: string,
    opts: { delayMs?: number; seen?: { value: boolean } } = {},
  ) {
    await page.route("**/api/upload/image", async (route) => {
      if (opts.seen) opts.seen.value = true;
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
      // The upload happens at creation time (creating phase), after the wizard steps.
      if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, imageUri: `ipfs://${cid}` }),
      });
    });
  }

  test("uploads image via file picker and sends description + imageUri with creation", async ({
    page,
  }) => {
    const cid = randomCid();
    const created: unknown[] = [];
    await setupOffline(page, { capture: { create: created } });
    await mockUploadImage(page, cid, { delayMs: 300 });
    await gotoWithAgent(page);
    await openCreateDialog(page);

    await page.getByTestId("create-name-input").fill("e2e-agent");
    await page.getByTestId("create-description-input").fill("A helpful e2e agent");

    await page.getByTestId("create-image-input").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a", "hex"),
    });

    // Picking an image only stages it locally — the upload happens at creation time.
    await expect(page.getByTestId("create-image-preview")).toBeVisible();
    await expect(page.getByTestId("create-image-ready")).toBeAttached();
    await expect(page.getByTestId("create-image-preview").locator("img")).toHaveAttribute(
      "alt",
      "avatar.png",
    );

    // Continue is not gated on the staged image
    const next = page.getByTestId("create-name-continue");
    await expect(next).toBeEnabled();
    await next.click();

    // Services are prefilled on the connections step
    await expect(page.getByTestId("create-web-endpoint")).toHaveValue("https://example.com");
    await expect(page.getByTestId("create-email-endpoint")).toHaveValue("e@mail.fun");
    await page.getByTestId("create-connections-continue").click();
    await expect(page.getByTestId("create-action-transfer-eth")).toBeVisible();

    // Walk to the last step and submit
    const dialog = page.getByTestId("create-dialog");
    await dialog.getByRole("button", { name: "Next →" }).click();
    await dialog.getByRole("button", { name: "Create agent" }).click();

    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15_000 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: "e2e-agent",
      description: "A helpful e2e agent",
      imageUri: `ipfs://${cid}`,
      services: expect.arrayContaining([
        { name: "web", endpoint: "https://example.com" },
        { name: "email", endpoint: "e@mail.fun" },
        { name: "mcp", endpoint: expect.stringMatching(/\/api\/mcp$/) },
        { name: "A2A", endpoint: expect.stringMatching(/\/api\/a2a\?agent=e2e-agent$/) },
      ]),
    });
  });

  test("uploads image via drag & drop", async ({ page }) => {
    const cid = randomCid();
    const seen = { value: false };
    await setupOffline(page, {});
    await mockUploadImage(page, cid, { seen });
    await gotoWithAgent(page);
    await openCreateDialog(page);

    // Synthesize a real drop with a File in the DataTransfer
    await page.evaluate(() => {
      const dropzone = document.querySelector('[data-testid="create-image-dropzone"]')!;
      const dt = new DataTransfer();
      dt.items.add(new File(["png-bytes"], "dropped.png", { type: "image/png" }));
      dropzone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    });

    await expect(page.getByTestId("create-image-preview")).toBeVisible();
    await expect(page.getByTestId("create-image-ready")).toBeAttached();
    expect(seen.value).toBe(false);
    await expect(page.getByTestId("create-image-preview").locator("img")).toHaveAttribute(
      "alt",
      "dropped.png",
    );
  });

  test("avatar opens the OS file picker (empty and with a staged image)", async ({ page }) => {
    await setupOffline(page, {});
    await gotoWithAgent(page);
    await openCreateDialog(page);

    const [emptyChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("create-image-dropzone").click(),
    ]);
    expect(emptyChooser.isMultiple()).toBe(false);

    await page.getByTestId("create-image-input").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a", "hex"),
    });
    await expect(page.getByTestId("create-image-preview")).toBeVisible();

    // Replacing a staged image must hit the input, not the remove button.
    await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("create-image-preview").click(),
    ]);
    await expect(page.getByTestId("create-image-preview")).toBeVisible();
  });

  test("rejects unsupported file types without uploading", async ({ page }) => {
    const seen = { value: false };
    await setupOffline(page, {});
    await mockUploadImage(page, "bafkreinever", { seen });
    await gotoWithAgent(page);
    await openCreateDialog(page);

    await page
      .getByTestId("create-image-input")
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });

    await expect(page.getByTestId("create-image-error")).toContainText("Unsupported image type");
    expect(seen.value).toBe(false);
  });

  test("image and description stay optional", async ({ page }) => {
    const created: unknown[] = [];
    await setupOffline(page, { capture: { create: created } });
    await gotoWithAgent(page);
    await openCreateDialog(page);

    await page.getByTestId("create-name-input").fill("e2e-agent");
    await page.getByTestId("create-name-continue").click();
    await page.getByTestId("create-connections-continue").click();
    const dialog = page.getByTestId("create-dialog");
    await dialog.getByRole("button", { name: "Next →" }).click();
    await dialog.getByRole("button", { name: "Create agent" }).click();

    await expect(page.getByText("Agent created")).toBeVisible({ timeout: 15_000 });
    expect(created).toHaveLength(1);
    expect(created[0]).not.toHaveProperty("description");
    expect(created[0]).not.toHaveProperty("imageUri");
  });
});
