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

  it("GET /api/catalog lists the supported networks with the default first", async () => {
    const body = (await (await app.request("/api/catalog")).json()) as {
      chainId: number;
      master: { balanceEth?: string };
      networks: { network: string; chainId: number; masterBalanceEth?: string }[];
    };
    expect(body.networks.map((n) => n.chainId)).toEqual([421614, 11155111, 5003]);
    expect(body.networks[0]?.chainId).toBe(body.chainId);
    expect(body.networks[1]?.masterBalanceEth).toBe("1.0");
    expect(body.master.balanceEth).toBe("1.0");
  });

  it("GET /api/health?chainId= reports that network; unsupported chains are 400", async () => {
    const sepolia = (await (await app.request("/api/health?chainId=11155111")).json()) as {
      network: string;
      chainId: number;
    };
    expect(sepolia).toMatchObject({ network: "Ethereum Sepolia", chainId: 11155111 });
    expect((await app.request("/api/health?chainId=1")).status).toBe(400);
  });

  it("POST /api/rpc?chainId= rejects unsupported chains before proxying", async () => {
    const res = await app.request("/api/rpc?chainId=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Unsupported chainId: 1");
  });

  it("POST /api/agents rejects an unsupported chainId before side effects", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "wrong-chain-agent", skipRegister: true, chainId: 1 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Unsupported chainId: 1");
  });

  it("DELETE /api/agents/:name 404s for unknown agent", async () => {
    const res = await app.request("/api/agents/ghost-agent-xyz", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("POST /api/agents validates OASF ids + fundEth range before side effects", async () => {
    const badOasf = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "oasf-probe-agent", oasfDomains: ["not-a-number"] }),
    });
    expect(badOasf.status).toBe(400);

    const badFund = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "oasf-probe-agent", fundEth: "5" }),
    });
    expect(badFund.status).toBe(400);
  });

  it("POST /api/upload/image validates backend + payload without pinning", async () => {
    // No IPFS backend -> deterministic 503 (clear env overrides from the dev .env).
    vi.stubEnv("PINATA_JWT", "");
    vi.stubEnv("IPFS_NODE_URL", "");
    const noBackend = await app.request("/api/upload/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noBackend.status).toBe(503);

    // With a (fake) backend configured, payload validation runs before any pin.
    vi.stubEnv("PINATA_JWT", "test-jwt");
    const notMultipart = await app.request("/api/upload/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(notMultipart.status).toBe(400);

    const emptyForm = new FormData();
    const missingFile = await app.request("/api/upload/image", {
      method: "POST",
      body: emptyForm,
    });
    expect(missingFile.status).toBe(400);

    const badType = new FormData();
    badType.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const badTypeRes = await app.request("/api/upload/image", {
      method: "POST",
      body: badType,
    });
    expect(badTypeRes.status).toBe(400);

    vi.stubEnv("PINATA_JWT", "");
  });

  it("POST /api/agents/:name/restore heals from a key-backed backup", async () => {
    const { ethers } = await import("ethers");
    const key = ethers.Wallet.createRandom();
    const goodConfig = {
      name: "restored-agent",
      description: "Agent restored-agent",
      walletAddress: key.address,
      walletChainId: 421614,
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: { actions: [], tools: [] },
      createdAt: new Date().toISOString(),
      updatedAt: 0,
    };

    // Wrong key must not overwrite.
    const wrongKey = ethers.Wallet.createRandom().privateKey;
    const forbidden = await app.request("/api/agents/restored-agent/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: goodConfig, privateKey: wrongKey }),
    });
    expect(forbidden.status).toBe(403);

    // Name mismatch rejected.
    const mismatch = await app.request("/api/agents/other-name/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: goodConfig, privateKey: key.privateKey }),
    });
    expect(mismatch.status).toBe(400);

    // Happy path restores the wallet + config.
    const ok = await app.request("/api/agents/restored-agent/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: goodConfig, privateKey: key.privateKey }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; agent: { name: string } };
    expect(body.ok).toBe(true);
  });

  it("GET /.well-known/agent-card.json + /api/a2a health", async () => {
    const cardRes = await app.request("/.well-known/agent-card.json");
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as {
      name: string;
      url: string;
      capabilities: { extensions?: { uri: string }[] };
    };
    expect(card.name).toBeTruthy();
    expect(card.url).toContain("/api/a2a");

    const health = await app.request("/api/a2a");
    expect(health.status).toBe(200);
    const body = (await health.json()) as { protocol: string; x402support: boolean };
    expect(body.protocol).toBe("a2a");
    expect(typeof body.x402support).toBe("boolean");
  });

  it("POST /api/a2a JSON-RPC message/send without extension fails when x402 on", async () => {
    vi.stubEnv("A2A_PAY_TO", "0x00000000000000000000000000000000000000aa");
    const res = await app.request("/api/a2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            kind: "message",
            role: "user",
            parts: [{ kind: "text", text: "charge me" }],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { status: { state: string; message: { metadata: Record<string, string> } } };
    };
    expect(body.result.status.state).toBe("failed");
    expect(body.result.status.message.metadata["x402.payment.error"]).toBe(
      "EXTENSION_NOT_ACTIVATED",
    );
  });

  it("?agent= scopes the Agent Card and its JSON-RPC url; bad names are 404", async () => {
    const res = await app.request("/.well-known/agent-card.json?agent=scoped-agent");
    expect(res.status).toBe(200);
    const card = (await res.json()) as { name: string; url: string };
    expect(card.name).toBe("scoped-agent");
    expect(card.url).toMatch(/\/api\/a2a\?agent=scoped-agent$/);

    const traversal = await app.request("/api/a2a?agent=..%2F..%2Fetc");
    expect(traversal.status).toBe(404);
  });

  it("generic endpoint is a free echo unless A2A_PAY_TO is set", async () => {
    vi.stubEnv("A2A_PAY_TO", "");
    const health = (await (await app.request("/api/a2a")).json()) as { x402support: boolean };
    expect(health.x402support).toBe(false);
    const res = await app.request("/api/a2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { kind: "message", role: "user", parts: [{ kind: "text", text: "ping" }] } },
      }),
    });
    const body = (await res.json()) as {
      result: { status: { state: string; message: { parts: { text: string }[] } } };
    };
    expect(body.result.status.state).toBe("completed");
    expect(body.result.status.message.parts[0]?.text).toBe("ping");
  });

  it("agent card advertises chat plus the agent's read-only tools only", async () => {
    const res = await app.request("/.well-known/agent-card.json?agent=scoped-agent");
    const card = (await res.json()) as { skills: { id: string }[] };
    expect(card.skills.map((s) => s.id)).toEqual(["chat"]);
  });

  it("GET /api/catalog reports the x402 mode and read-only tools", async () => {
    const body = (await (await app.request("/api/catalog")).json()) as {
      x402: { mode: string };
      tools: { name: string; readOnly: boolean }[];
    };
    expect(body.x402.mode).toBe("mock");
    expect(body.tools.filter((t) => t.readOnly).map((t) => t.name)).toEqual([
      "get_token_balance",
      "fetch_contract_abi",
    ]);
  });

  it("POST /api/agents rejects x402support without an A2A endpoint", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x402-no-a2a-agent", skipRegister: true, x402support: true }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("A2A endpoint");
  });

  it("POST /api/a2a with malformed JSON is a 400 parse error", async () => {
    const res = await app.request("/api/a2a", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("POST /api/agents rejects bad a2a endpoint URL", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "a2a-bad-url-agent",
        skipRegister: true,
        a2aEndpoint: "ftp://not-allowed/a2a",
      }),
    });
    expect(res.status).toBe(400);
  });
});
