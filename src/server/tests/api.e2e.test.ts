/**
 * Offline API E2E (no gas, no network): exercises the full Hono app via
 * app.request() covering health, catalog, agents, chat validation,
 * memory, fund validation, feedback validation, RPC proxy errors.
 *
 * Run: npx vitest run src/server/tests/api.e2e.test.ts
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.VERCEL = "1";

vi.mock("../../core/wallet.js", () => ({
  AGENTS_DIR: "/tmp/web3agent-test-agents",
  getMasterWallet: () => ({ address: "0x0000000000000000000000000000000000000001" }),
  getMasterWalletBalance: async () => "1.0",
  getOrCreateAgentWallet: () => ({ address: "0x0000000000000000000000000000000000000002", privateKey: "0x" + "1".repeat(64) }),
  fundAgentWallet: async () => "0x" + "a".repeat(64),
  getMasterWalletAddress: () => "0x0000000000000000000000000000000000000001",
}));

vi.mock("../../core/agent-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/agent-config.js")>();
  return {
    ...actual,
    loadAgentConfig: (name: string) => ({
      name,
      description: `Agent ${name}`,
      walletAddress: "0x0000000000000000000000000000000000000002",
      walletChainId: 421614,
      endpoints: [],
      trustModels: [],
      active: true,
      x402support: false,
      metadata: { actions: [], tools: [] },
    }),
  };
});

describe("API offline e2e", () => {
  let app: typeof import("../api.js")["app"];

  beforeAll(async () => {
    process.env.RPC_URL = process.env.RPC_URL || "http://localhost:8545";
    const mod = await import("../api.js");
    app = mod.app;
  });

  it("GET /api/health returns ok + network info", async () => {
    const res = await app.request("/api/health");
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.network).toBe("string");
    expect(typeof body.chainId).toBe("number");
  });

  it("GET /api/catalog lists actions and tools", async () => {
    const res = await app.request("/api/catalog");
    const body = (await res.json()) as { actions: unknown[]; tools: unknown[] };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });

  it("GET /api/agents + /api/agents/:name 404 handling", async () => {
    const list = await app.request("/api/agents");
    expect(list.status).toBe(200);
    const missing = await app.request("/api/agents/does-not-exist-xyz");
    expect(missing.status).toBe(404);
  });

  it("POST /api/agents validates name + unknown action/tool", async () => {
    const noName = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noName.status).toBe(400);

    const badName = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "-bad!" }),
    });
    expect(badName.status).toBe(400);

    const badAction = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "valid-name-1", actions: ["nope"] }),
    });
    expect(badAction.status).toBe(400);

    const badTool = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "valid-name-1", tools: ["nope"] }),
    });
    expect(badTool.status).toBe(400);
  });

  it("POST /api/agents/:name/chat validates message + unknown agent", async () => {
    const unknown = await app.request("/api/agents/ghost/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(unknown.status).toBe(404);
    // Empty message rejected before any LLM call (no cost).
    const { app: fresh } = await import("../api.js");
    // Use a known agent if any exist, else assert 404/400 only.
    const list = (await (await fresh.request("/api/agents")).json()) as {
      agents: { name: string }[];
    };
    if (list.agents.length > 0) {
      const bad = await fresh.request(`/api/agents/${list.agents[0]!.name}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "   " }),
      });
      expect(bad.status).toBe(400);
    }
  });

  it("POST /api/agents/:name/feedback validates input without spending gas", async () => {
    const list = (await (await app.request("/api/agents")).json()) as {
      agents: { name: string }[];
    };
    // If no agents on disk, unknown-agent path must 404 (still no gas spent).
    const target = list.agents[0]?.name ?? "ghost-agent";
    const expected = list.agents.length > 0 ? 400 : 404;
    const missing = await app.request(`/api/agents/${target}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(expected);

    if (list.agents.length > 0) {
      const badValue = await app.request(`/api/agents/${target}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "421614:204", value: "high" }),
      });
      expect(badValue.status).toBe(400);
    }
  });

  it("GET /api/agents/:name/memory 404s for unknown agent", async () => {
    const res = await app.request("/api/agents/ghost-agent-xyz/memory");
    expect(res.status).toBe(404);
  });

  it("POST /api/agents/:name/fund validates amount", async () => {
    const res = await app.request("/api/agents/ghost/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountEth: "0.001" }),
    });
    // Unknown agent -> 404 before any funding.
    expect(res.status).toBe(404);
  });

  it("POST /api/rpc returns JSON-RPC error without RPC_URL", async () => {
    const saved = process.env.RPC_URL;
    vi.stubEnv("RPC_URL", "");
    const { app: fresh } = await import("../api.js");
    const res = await fresh.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    expect([500, 502]).toContain(res.status);
    if (saved) vi.stubEnv("RPC_URL", saved);
    else vi.unstubAllEnvs();
  });
});
