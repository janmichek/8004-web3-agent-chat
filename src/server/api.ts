/**
 * HTTP API for the Vue frontend: list agents and chat.
 *
 * Usage:
 *   npm run serve
 */

import { AGENT_NAME_RE } from "../core/agent-path.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import {
  AGENTS_DIR,
  fundAgentWallet,
  getMasterWalletBalance,
  getMasterWallet,
} from "../core/wallet.js";
import { loadAgentConfig, deleteAgentConfig } from "../core/agent-config.js";
import { ethers } from "ethers";
import {
  getAgentScanUrl,
  getChainId,
  getDefaultNetwork,
  getNetworkConfig,
  getRpcUrl,
  getActiveNetwork,
  getSupportedNetworkByChainId,
  getSupportedNetworks,
  runWithNetwork,
} from "../core/config.js";
import type { NetworkName } from "../core/types.js";
import { ACTION_REGISTRY, TOOL_REGISTRY } from "../core/action-registry.js";
import { parseAgentConfig, saveAgentConfig, type AgentConfig } from "../core/agent-config.js";
import { hasIpfsBackend, uploadImage, validateImage } from "../core/ipfs.js";
import { readAgentMemoryAsync } from "../core/memory-reader.js";
import { A2AServer, type A2AExecutor } from "../a2a/server.js";
import { HttpFacilitatorClient } from "../a2a/http-facilitator.js";
import { MockFacilitatorClient } from "../a2a/mock-facilitator.js";
import { DEFAULT_PRICE_ATOMIC, MOCK_PAYMENT_NETWORK } from "../a2a/x402.js";
import {
  a2aToolNames,
  agentExists,
  agentNetwork,
  listExistingAgents,
  publicAgentSummary,
  x402Mode,
} from "./agent-catalog.js";
import { runChat } from "./chat-runtime.js";
import {
  checkRateLimit,
  errMsg,
  getClientIp,
  overSpendBudget,
  RATE_LIMITED,
  readJsonBody,
} from "./http-utils.js";
import { handleMcp } from "./mcp-proxy.js";
import { createAgentHandler } from "./routes/create-agent.js";

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);

/** Anonymous A2A callers can make the agent's LLM work, so cap them per IP. */
const A2A_RATE_MAX = Number(process.env.MCP_RATE_MAX || 60);

/** Per-IP budget for the JSON-RPC proxy (in-page viem + connected wallets are chatty). */
const RPC_RATE_MAX = Number(process.env.RPC_RATE_MAX || 300);
/** Upper bound for a proxied JSON-RPC body; real calls are a few KB. */
const RPC_MAX_BODY_BYTES = 64 * 1024;

export const app = new Hono();

const isVercel = !!process.env.VERCEL;

function resolveCorsOrigin(): string | string[] {
  const configured = process.env.CORS_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;
  return isVercel ? "*" : ["http://localhost:5173", "http://127.0.0.1:5173"];
}

app.use(
  "*",
  cors({
    origin: resolveCorsOrigin(),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
      "Last-Event-ID",
      "X-A2A-Extensions",
    ],
    exposeHeaders: ["mcp-session-id"],
  }),
);

// --- A2A + x402 --------------------------------------------------------------
// Agent Card at /.well-known/agent-card.json; JSON-RPC at /api/a2a (and /a2a).
// ?agent=<name> serves that agent: its LLM answers with its read-only tools,
// and x402 follows its config. Without ?agent= a generic echo endpoint answers.
// Servers hold their tasks in memory, so one is kept per agent and rebuilt
// only when its `stamp` (public URL + config revision) changes.
const a2aServers = new Map<string, { stamp: string; server: A2AServer }>();

/** Real verify/settle when X402_FACILITATOR_URL is set, simulated otherwise. */
const x402FacilitatorUrl = process.env.X402_FACILITATOR_URL?.trim();
const x402Facilitator = x402FacilitatorUrl
  ? new HttpFacilitatorClient(x402FacilitatorUrl)
  : new MockFacilitatorClient();

function defaultA2AConfig(): AgentConfig {
  const payTo = process.env.A2A_PAY_TO?.trim();
  return {
    name: "web3agent",
    description: "web3agent A2A endpoint (echo). Use ?agent=<name> to reach an agent.",
    walletAddress: payTo || undefined,
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    // Paid only when there is somewhere to pay to.
    x402support: Boolean(payTo) && process.env.A2A_X402 !== "0",
    metadata: { actions: [], tools: [] },
    createdAt: "",
    updatedAt: 0,
  };
}

function agentA2AExecutor(config: AgentConfig): A2AExecutor {
  return {
    skills: [
      {
        id: "chat",
        name: "chat",
        description: config.description || `Ask ${config.name} a question`,
        tags: ["chat"],
      },
      ...a2aToolNames(config).map((name) => ({
        id: `tool:${name}`,
        name,
        description: TOOL_REGISTRY.find((t) => t.name === name)?.description ?? name,
        tags: ["tool", "read-only"],
      })),
    ],
    run: async (text) => (await runChat(config.name, text, true)).reply,
  };
}

/** Returns null for an unknown `?agent=`. */
function resolveA2AServer(c: Context): A2AServer | null {
  const agentName = c.req.query("agent")?.trim() ?? "";
  const config = !agentName
    ? defaultA2AConfig()
    : AGENT_NAME_RE.test(agentName)
      ? loadAgentConfig(agentName)
      : null;
  if (!config) return null;

  const proto = c.req.header("x-forwarded-proto") || "http";
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || `localhost:${PORT}`;
  const endpointUrl = `${proto}://${host}/api/a2a${agentName ? `?agent=${encodeURIComponent(agentName)}` : ""}`;
  const stamp = [
    endpointUrl,
    config.x402support,
    config.walletAddress,
    config.active,
    config.updatedAt,
  ].join("|");

  const cached = a2aServers.get(agentName);
  if (cached?.stamp === stamp) return cached.server;
  const server = new A2AServer({
    endpointUrl,
    config,
    facilitator: x402Facilitator,
    ...(agentName ? { executor: agentA2AExecutor(config) } : {}),
  });
  a2aServers.set(agentName, { stamp, server });
  return server;
}

function unknownA2AAgent(c: Context) {
  return c.json({ error: `Unknown agent: ${c.req.query("agent")}` }, 404);
}

app.get("/.well-known/agent-card.json", (c) => {
  const server = resolveA2AServer(c);
  return server ? c.json(server.buildAgentCard()) : unknownA2AAgent(c);
});

async function handleA2A(c: Context) {
  const server = resolveA2AServer(c);
  if (!server) return unknownA2AAgent(c);

  if (c.req.method === "GET") return c.json(server.healthDescriptor());
  if (c.req.method !== "POST") {
    return c.json({ error: "Use GET for health or POST for JSON-RPC" }, 405);
  }

  // Anonymous callers can make the agent's LLM work, so cap them per IP.
  if (!checkRateLimit(`a2a:${getClientIp(c)}`, A2A_RATE_MAX)) {
    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Rate limited, try again later" },
      },
      429,
    );
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  // Protocol-level errors travel inside the JSON-RPC body with HTTP 200.
  return c.json(await server.handleJsonRpc(body, c.req.header("x-a2a-extensions")));
}
app.all("/api/a2a", handleA2A);
app.all("/a2a", handleA2A);

// MCP over Streamable HTTP at /api/mcp (and /mcp for legacy). The handler
// lives in mcp-proxy.ts; discovery is open, execution requires Bearer auth.
app.all("/api/mcp", async (c) => handleMcp(c));
app.all("/mcp", async (c) => handleMcp(c));

// Return JSON (not Hono's default plain-text "404 Not Found") so the
// frontend's res.json() never chokes on unknown routes with a cryptic
// "unexpected non-whitespace character after JSON data" error.
app.notFound((c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

// --- Multichain: scope each request to one network ---------------------------
// Providers, the agent0 SDK and agent tools all read the active network, so
// these run the downstream handler on the chain the request is about.

/** Agent sub-routes (fund/chat/feedback/...) act on the agent's own chain. */
app.use("/api/agents/:name/*", async (c, next) => {
  const name = c.req.param("name");
  const config = AGENT_NAME_RE.test(name) ? loadAgentConfig(name) : null;
  return runWithNetwork(agentNetwork(config), next);
});

/** Creation picks the chain with `chainId` in the body (default: NETWORK). */
app.post("/api/agents", async (c, next) => {
  let chainId: unknown;
  try {
    chainId = ((await c.req.json()) as { chainId?: unknown } | null)?.chainId;
  } catch {
    return next(); // the handler reports the invalid body
  }
  if (chainId == null) return next();
  const network = getSupportedNetworkByChainId(chainId);
  if (!network) return c.json({ error: unsupportedChainMessage(chainId) }, 400);
  return runWithNetwork(network, next);
});

function unsupportedChainMessage(chainId: unknown): string {
  const supported = getSupportedNetworks()
    .map((n) => getChainId(n))
    .join(", ");
  return `Unsupported chainId: ${String(chainId)}. Supported: ${supported}`;
}

/** `?chainId=` on read-only routes; undefined when absent, null when unsupported. */
function queryNetwork(c: Context): NetworkName | null | undefined {
  const chainId = c.req.query("chainId");
  if (chainId == null || chainId === "") return undefined;
  return getSupportedNetworkByChainId(chainId) ?? null;
}

async function masterInfo(): Promise<{ address?: string; balanceEth?: string }> {
  try {
    const wallet = getMasterWallet();
    return { address: wallet.address, balanceEth: await getMasterWalletBalance() };
  } catch {
    return {}; // master key is optional for health/catalog
  }
}

/** Every network agents can be created on, with the master wallet's balance there. */
async function supportedNetworkSummaries() {
  return Promise.all(
    getSupportedNetworks().map((network) =>
      runWithNetwork(network, async () => {
        const config = getNetworkConfig();
        return {
          network,
          name: config.name,
          chainId: config.chainId,
          explorerUrl: config.explorerUrl,
          masterBalanceEth: (await masterInfo()).balanceEth,
        };
      }),
    ),
  );
}

app.get("/api/health", async (c) => {
  const network = queryNetwork(c);
  if (network === null)
    return c.json({ error: unsupportedChainMessage(c.req.query("chainId")) }, 400);
  return runWithNetwork(network ?? getDefaultNetwork(), async () =>
    c.json({
      ok: true,
      network: getNetworkConfig().name,
      chainId: getNetworkConfig().chainId,
      master: await masterInfo(),
    }),
  );
});

/**
 * Proxy JSON-RPC to the network's configured RPC (avoids public/Alchemy
 * browser rate limits). `?chainId=` selects the network (default: NETWORK).
 */
app.post("/api/rpc", async (c) => {
  const network = queryNetwork(c);
  if (network === null) {
    const message = unsupportedChainMessage(c.req.query("chainId"));
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32602, message } }, 400);
  }
  let rpcUrl: string;
  try {
    rpcUrl = getRpcUrl(network);
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 500);
  }

  const body = await c.req.text();
  if (Buffer.byteLength(body) > RPC_MAX_BODY_BYTES) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "request body too large" } },
      413,
    );
  }
  // The proxy relays to the configured (paid) RPC, so cap each client's quota.
  // No method allowlist: connected wallets also broadcast eth_sendRawTransaction here.
  if (!checkRateLimit(`rpc:${getClientIp(c)}`, RPC_RATE_MAX)) {
    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "rate limited, try again later" },
      },
      429,
    );
  }
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 502);
  }
});

app.get("/api/catalog", async (c) => {
  const networks = await supportedNetworkSummaries();
  const defaultChainId = getChainId();
  let masterAddress: string | undefined;
  try {
    masterAddress = getMasterWallet().address;
  } catch {
    /* master key may be missing */
  }

  return c.json({
    network: getActiveNetwork(),
    networkName: getNetworkConfig().name,
    chainId: defaultChainId,
    master: {
      address: masterAddress,
      balanceEth: networks.find((n) => n.chainId === defaultChainId)?.masterBalanceEth,
    },
    networks,
    actions: ACTION_REGISTRY.map((a) => ({
      name: a.name,
      description: a.description,
      toolNames: a.toolNames,
      skillName: a.skillName,
    })),
    tools: TOOL_REGISTRY.map((t) => ({
      name: t.name,
      description: t.description,
      readOnly: t.readOnly,
    })),
    x402: {
      // "mock": payments are simulated. "facilitator": verified + settled on-chain.
      mode: x402Mode(),
      network: MOCK_PAYMENT_NETWORK,
      maxAmountRequired: DEFAULT_PRICE_ATOMIC,
    },
  });
});

app.get("/api/agents", async (c) => {
  const names = listExistingAgents();
  const agents = await Promise.all(names.map((name) => publicAgentSummary(name, true)));
  // Latest conversation first; never-used agents keep their relative order.
  agents.sort((a, b) => {
    const aTs = a.lastActive ? Date.parse(a.lastActive) : 0;
    const bTs = b.lastActive ? Date.parse(b.lastActive) : 0;
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });
  return c.json({ agents });
});

/** Optional image upload (multipart) → pinned to IPFS, returns https gateway URL. */
app.post("/api/upload/image", async (c) => {
  if (!hasIpfsBackend()) {
    return c.json({ error: "No IPFS backend configured (set PINATA_JWT or IPFS_NODE_URL)" }, 503);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data with a `file` field" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing `file` field" }, 400);
  }
  const err = validateImage(file.name, file.type, file.size);
  if (err) return c.json({ error: err }, 400);
  try {
    const imageUri = await uploadImage({
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      fileName: file.name,
    });
    return c.json({ ok: true, imageUri });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/agents", createAgentHandler);

app.get("/api/agents/:name", async (c) => {
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ agent: await publicAgentSummary(name) });
});

/**
 * Heal a cold serverless instance from a browser-held backup.
 *
 * On Vercel without shared storage, agent files live only in /tmp on the
 * instance that created them. The create response returns the full config +
 * private key once (ephemeral mode); the frontend stores them in
 * localStorage and replays them here when it hits 404, so chat/fund/memory
 * keep working.
 *
 * Auth = proof of private-key ownership: the key must derive
 * config.walletAddress, and config.name must match the URL.
 */
app.post("/api/agents/:name/restore", async (c) => {
  const name = c.req.param("name");
  const body = await readJsonBody<{ config?: AgentConfig; privateKey?: string }>(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  const config = body.config;
  const privateKey = body.privateKey?.trim();
  if (!config || typeof config !== "object" || !privateKey) {
    return c.json({ error: "config and privateKey are required" }, 400);
  }
  if (config.name !== name) {
    return c.json({ error: "config.name must match the URL" }, 400);
  }
  if (!AGENT_NAME_RE.test(name)) {
    return c.json({ error: "invalid agent name" }, 400);
  }
  let validated: AgentConfig;
  try {
    validated = parseAgentConfig(config);
  } catch {
    return c.json({ error: "config has an invalid shape" }, 400);
  }
  if (!validated.walletAddress || !ethers.isAddress(validated.walletAddress)) {
    return c.json({ error: "config.walletAddress is invalid" }, 400);
  }
  const walletAddress = validated.walletAddress;
  let derived: string;
  try {
    derived = new ethers.Wallet(privateKey).address;
  } catch {
    return c.json({ error: "privateKey is invalid" }, 400);
  }
  if (derived.toLowerCase() !== walletAddress.toLowerCase()) {
    return c.json({ error: "privateKey does not match config.walletAddress" }, 403);
  }
  // Heal only missing agents. A key proves ownership of its *own* wallet, not of
  // an existing agent, so overwriting would let anyone take over a live agent.
  if (agentExists(name)) {
    return c.json({ error: "Agent already exists on this instance; restore is heal-only" }, 409);
  }
  try {
    const agentDir = path.join(AGENTS_DIR, name);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "wallet.json"),
      JSON.stringify({ address: walletAddress, privateKey }, null, 2),
      "utf-8",
    );
    saveAgentConfig(name, { ...validated, name });
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: `Restore failed: ${msg}` }, 500);
  }
  return c.json({ ok: true, agent: await publicAgentSummary(name) });
});

app.delete("/api/agents/:name", async (c) => {
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  if (process.env.VERCEL && !process.env.ALLOW_AGENT_DELETE) {
    return c.json(
      {
        error:
          "Agent deletion is disabled on Vercel (ephemeral filesystem). Delete env vars manually.",
      },
      403,
    );
  }
  const removed = deleteAgentConfig(name);
  if (!removed) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ ok: true, name });
});

app.post("/api/agents/:name/fund", async (c) => {
  if (overSpendBudget(c, "fund")) return c.json({ error: RATE_LIMITED }, 429);
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const summary = await publicAgentSummary(name);
  if (!summary.walletAddress) {
    return c.json({ error: "Agent has no wallet address" }, 400);
  }

  const body = await readJsonBody<{ amountEth?: string }>(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const amountEth = body.amountEth?.trim() || "0.001";
  const amount = Number(amountEth);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1) {
    return c.json({ error: "amountEth must be a number between 0 and 1" }, 400);
  }

  try {
    const txHash = await fundAgentWallet({
      agentAddress: summary.walletAddress,
      amountEth,
    });
    return c.json({
      ok: true,
      txHash,
      amountEth,
      to: summary.walletAddress,
      from: getMasterWallet().address,
    });
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/agents/:name/memory", async (c) => {
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  try {
    const memory = await readAgentMemoryAsync(name);
    return c.json(memory);
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/agents/:name/chat", async (c) => {
  if (overSpendBudget(c, "chat")) return c.json({ error: RATE_LIMITED }, 429);
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const body = await readJsonBody<{ message?: string }>(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  try {
    const result = await runChat(name, message);
    return c.json(result);
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: msg }, 500);
  }
});

// Unsigned giveFeedback tx for the connected wallet to sign (feedback author = that wallet).
app.post("/api/agents/:name/feedback/prepare", async (c) => {
  const name = c.req.param("name");
  if (!agentExists(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  const body = await readJsonBody<{
    agentId?: string;
    value?: unknown;
    tag?: string;
    endpoint?: string;
    comment?: string;
    clientAddress?: string;
  }>(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  if (!body.clientAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.clientAddress)) {
    return c.json({ error: "Connect a wallet to rate" }, 401);
  }
  const summary = await publicAgentSummary(name);
  const agentId = body.agentId?.trim() || summary.agentId;
  if (!agentId) return c.json({ error: "agentId is required" }, 400);
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return c.json({ error: "value must be a number 0-100" }, 400);
  }
  try {
    const { prepareFeedback } = await import("../core/reputation.js");
    const tx = await prepareFeedback({
      agentId,
      value: body.value,
      tag: body.tag,
      endpoint: body.endpoint,
      comment: body.comment,
      clientAddress: body.clientAddress,
    });
    return c.json({ ok: true, ...tx, scanUrl: getAgentScanUrl(String(agentId)) });
  } catch (err) {
    return c.json({ error: errMsg(err) }, 500);
  }
});

app.get("/api/reputation/:agentId", async (c) => {
  const agentId = c.req.param("agentId")?.trim();
  if (!agentId) {
    return c.json({ error: "agentId is required" }, 400);
  }
  try {
    const { getReputationSummary } = await import("../core/reputation.js");
    const summary = await getReputationSummary(agentId, c.req.query("tag"));
    return c.json({ agentId, ...summary });
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: msg }, 500);
  }
});

if (!process.env.VERCEL) {
  console.log(`web3agent API listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}

export default app;
