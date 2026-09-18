/**
 * HTTP API for the Vue frontend: list agents and chat.
 *
 * Usage:
 *   npm run serve
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import dotenv from "dotenv";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { getLLM } from "../core/llm.js";
import {
  AGENTS_DIR,
  fundAgentWallet,
  getMasterWalletBalance,
  getMasterWallet,
  getOrCreateAgentWallet,
} from "../core/wallet.js";
import { discoverAgentSkills, resolveAgentSkills } from "../core/agent-skills.js";
import { createFileCheckpointer } from "../core/file-checkpoint.js";
import {
  loadAgentConfig,
  resolveToolsFromConfig,
  buildCapabilitySummary,
  deleteAgentConfig,
} from "../core/agent-config.js";
import { ethers } from "ethers";
import {
  getChainId,
  getNetworkNameByChainId,
  getNetworkConfig,
  getRpcUrl,
  getActiveNetwork,
  getProvider,
} from "../core/config.js";
import { ACTION_REGISTRY, TOOL_REGISTRY, getActionByName } from "../core/action-registry.js";
import { saveAgentConfig, type AgentConfig } from "../core/agent-config.js";
import { registerAgent } from "../core/registry.js";
import { readAgentMemory } from "../core/memory-reader.js";
import type { Skill } from "../actions/types.js";

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);

type ChatEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; content: string }
  | { type: "message"; content: string };

function agentEnvSuffix(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function listEnvAgents(): string[] {
  const agents = new Set<string>();
  for (const key of Object.keys(process.env)) {
    // AGENT_<SUFFIX>_CONFIG or AGENT_<SUFFIX>_PRIVATE_KEY
    const m = key.match(/^AGENT_(.+)_CONFIG$/) || key.match(/^AGENT_(.+)_PRIVATE_KEY$/);
    if (m) {
      const suffix = m[1];
      // reverse to original name is ambiguous, so we store mapping via config name field
      // Instead, derive from config JSON's name or brute-force by checking all env suffixes against known pattern
      // For now, extract name from config JSON if available
      const raw = process.env[key];
      if (raw && key.endsWith("_CONFIG")) {
        try {
          const parsed = JSON.parse(raw) as { name?: string };
          if (parsed.name) agents.add(parsed.name);
          else agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        } catch {
          agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        }
      } else if (raw) {
        // private key only — try to find matching config env, otherwise use suffix as name
        const configKey = `AGENT_${suffix}_CONFIG`;
        const configRaw = process.env[configKey];
        if (configRaw) {
          try {
            const parsed = JSON.parse(configRaw) as { name?: string };
            if (parsed.name) agents.add(parsed.name);
          } catch { /* ignore */ }
        }
        // fallback: if we haven't added yet, use suffix lowercased
        if (!agents.has(suffix.toLowerCase().replace(/_/g, "-"))) {
          // Only add if not already covered by config
          const hasConfig = [...agents].some((a) => agentEnvSuffix(a) === suffix);
          if (!hasConfig) agents.add(suffix.toLowerCase().replace(/_/g, "-"));
        }
      }
    }
  }
  return [...agents];
}

function listExistingAgents(): string[] {
  const fromFs = new Set<string>();
  const dirsToScan = [AGENTS_DIR];
  if (process.env.VERCEL) dirsToScan.push(path.resolve(process.cwd(), "agents"));
  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      // On Vercel, existence of wallet via env is enough; on FS check wallet.json
      // Also include config-only agents (agent-config.json without wallet yet)
      // so newly created agents always appear in the picker.
      const walletPath = path.join(dir, e.name, "wallet.json");
      const configPath = path.join(dir, e.name, "agent-config.json");
      const envPk = process.env[`AGENT_${agentEnvSuffix(e.name)}_PRIVATE_KEY`];
      if (fs.existsSync(walletPath) || fs.existsSync(configPath) || envPk) fromFs.add(e.name);
    }
  }
  // Merge env agents
  for (const n of listEnvAgents()) fromFs.add(n);
  return [...fromFs];
}

function publicAgentSummary(name: string) {
  const config = loadAgentConfig(name);
  let walletAddress: string | undefined = config?.walletAddress;
  // Try env private key first
  if (!walletAddress) {
    const envPk = process.env[`AGENT_${agentEnvSuffix(name)}_PRIVATE_KEY`];
    if (envPk) {
      try { walletAddress = new ethers.Wallet(envPk).address; } catch { /* ignore */ }
    }
  }
  if (!walletAddress) {
    const candidates = [path.join(AGENTS_DIR, name, "wallet.json")];
    if (process.env.VERCEL) candidates.push(path.join(path.resolve(process.cwd(), "agents"), name, "wallet.json"));
    for (const walletPath of candidates) {
      if (!fs.existsSync(walletPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as { address?: string };
        walletAddress = raw.address;
        break;
      } catch { /* ignore */ }
    }
  }

  return {
    name,
    description: config?.description ?? `Agent ${name}`,
    walletAddress,
    walletChainId: config?.walletChainId ?? getNetworkConfig().chainId,
    agentId: config?.agentId,
    agentURI: config?.agentURI,
    actions: config?.metadata?.actions ?? [],
    tools: config?.metadata?.tools ?? [],
    active: config?.active ?? true,
  };
}

async function runChat(agentName: string, message: string): Promise<{
  reply: string;
  events: ChatEvent[];
}> {
  const wallet = getOrCreateAgentWallet({ agentName });
  process.env.AGENT_PRIVATE_KEY = wallet.privateKey;

  const agentConfig = loadAgentConfig(agentName);
  let tools: Awaited<ReturnType<typeof resolveAgentSkills>>;
  let skills: Skill[] = [];

  if (agentConfig) {
    const resolved = resolveToolsFromConfig(agentConfig);
    tools = resolved.tools;
    skills = resolved.skills;
  } else {
    tools = await resolveAgentSkills(agentName, wallet.privateKey);
  }

  const { saver, flush } = createFileCheckpointer(agentName);

  const networkName = agentConfig?.walletChainId
    ? getNetworkNameByChainId(agentConfig.walletChainId)
    : getNetworkConfig().name;

  const skillContext = skills.map((s) => `## Skill: ${s.name}\n\n${s.context}`).join("\n\n");
  const capabilitySummary = agentConfig
    ? buildCapabilitySummary(agentConfig)
    : "No capabilities configured.";
  const systemMessage = [
    `You are "${agentName}", an onchain AI agent on ${networkName}.`,
    `Your wallet address is: ${wallet.address}`,
    agentConfig?.walletChainId ? `Chain ID: ${agentConfig.walletChainId}` : "",
    agentConfig?.agentId ? `ERC-8004 Agent ID: ${agentConfig.agentId}` : "",
    "",
    `## Your Capabilities\n\n${capabilitySummary}`,
    skillContext,
  ]
    .filter(Boolean)
    .join("\n");

  const llm = getLLM();
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: saver,
    prompt: systemMessage,
  });

  const events: ChatEvent[] = [];
  let reply = "";

  const stream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    { configurable: { thread_id: agentName }, recursionLimit: 8, streamMode: "updates" },
  );

  for await (const update of stream) {
    for (const output of Object.values(update)) {
      const messages = (output as { messages?: unknown[] })?.messages ?? [];
      for (const msg of messages) {
        const m = msg as {
          _getType?: () => string;
          content?: unknown;
          tool_calls?: { name: string; args: unknown }[];
        };
        const role = m._getType?.() ?? "unknown";
        const content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");

        if (role === "ai") {
          const calls = m.tool_calls ?? [];
          for (const tc of calls) {
            events.push({ type: "tool_call", name: tc.name, args: tc.args });
          }
          if (content.trim()) {
            events.push({ type: "message", content: content.trim() });
            reply = content.trim();
          }
        } else if (role === "tool") {
          events.push({ type: "tool_result", content: content.slice(0, 2000) });
        }
      }
    }
  }

  flush();
  return { reply: reply || "(no response)", events };
}

export const app = new Hono();

const isVercel = !!process.env.VERCEL;

app.use(
  "*",
  cors({
    origin: isVercel ? "*" : ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// Return JSON (not Hono's default plain-text "404 Not Found") so the
// frontend's res.json() never chokes on unknown routes with a cryptic
// "unexpected non-whitespace character after JSON data" error.
app.notFound((c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

app.get("/api/health", async (c) => {
  let master: { address?: string; balanceEth?: string } = {};
  try {
    const wallet = getMasterWallet();
    master = {
      address: wallet.address,
      balanceEth: await getMasterWalletBalance(),
    };
  } catch {
    /* master key optional for health */
  }
  return c.json({
    ok: true,
    network: getNetworkConfig().name,
    chainId: getNetworkConfig().chainId,
    master,
  });
});

/** Proxy JSON-RPC to the configured RPC_URL (avoids public/Alchemy browser rate limits). */
app.post("/api/rpc", async (c) => {
  let rpcUrl: string;
  try {
    rpcUrl = getRpcUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 500);
  }

  const body = await c.req.text();
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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: msg } }, 502);
  }
});

app.get("/api/catalog", async (c) => {
  let master: { address?: string; balanceEth?: string } = {};
  try {
    const wallet = getMasterWallet();
    master = {
      address: wallet.address,
      balanceEth: await getMasterWalletBalance(),
    };
  } catch {
    /* master key may be missing */
  }

  return c.json({
    network: getActiveNetwork(),
    networkName: getNetworkConfig().name,
    chainId: getNetworkConfig().chainId,
    master,
    actions: ACTION_REGISTRY.map((a) => ({
      name: a.name,
      description: a.description,
      toolNames: a.toolNames,
      skillName: a.skillName,
    })),
    tools: TOOL_REGISTRY.map((t) => ({
      name: t.name,
      description: t.description,
    })),
  });
});

app.get("/api/agents", (c) => {
  const agents = listExistingAgents().map(publicAgentSummary);
  return c.json({ agents });
});

app.post("/api/agents", async (c) => {
  let body: {
    name?: string;
    actions?: string[];
    tools?: string[];
    fundEth?: string;
    skipRegister?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(name)) {
    return c.json({
      error: "name must be 1–63 chars: letters, numbers, . _ - (start with alphanumeric)",
    }, 400);
  }
  if (listExistingAgents().includes(name)) {
    return c.json({ error: `Agent "${name}" already exists` }, 409);
  }

  const selectedActions = Array.isArray(body.actions) ? body.actions : [];
  const selectedTools = Array.isArray(body.tools) ? body.tools : [];

  for (const actionName of selectedActions) {
    if (!getActionByName(actionName)) {
      return c.json({ error: `Unknown action: ${actionName}` }, 400);
    }
  }

  const actionToolNames = new Set<string>();
  for (const actionName of selectedActions) {
    const entry = getActionByName(actionName);
    if (entry) {
      for (const t of entry.toolNames) actionToolNames.add(t);
    }
  }

  const knownTools = new Set(TOOL_REGISTRY.map((t) => t.name));
  for (const toolName of selectedTools) {
    if (!knownTools.has(toolName)) {
      return c.json({ error: `Unknown tool: ${toolName}` }, 400);
    }
  }

  const standaloneTools = selectedTools.filter((t) => !actionToolNames.has(t));
  const allToolNames = [...new Set([...actionToolNames, ...standaloneTools])];

  const fundEth = (body.fundEth?.trim() || "0.002");
  const fundAmount = Number(fundEth);
  if (!Number.isFinite(fundAmount) || fundAmount < 0 || fundAmount > 1) {
    return c.json({ error: "fundEth must be a number between 0 and 1" }, 400);
  }

  const skipRegister = Boolean(body.skipRegister);
  const steps: { step: string; ok: boolean; detail?: string }[] = [];

  let masterWallet: ReturnType<typeof getMasterWallet>;
  try {
    masterWallet = getMasterWallet();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Master wallet unavailable: ${msg}` }, 500);
  }

  // --- Create wallet ---
  let agentWallet: ReturnType<typeof getOrCreateAgentWallet>;
  try {
    agentWallet = getOrCreateAgentWallet({ agentName: name });
    steps.push({ step: "wallet", ok: true, detail: agentWallet.address });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Wallet creation failed: ${msg}`, steps }, 500);
  }

  // --- Fund ---
  let fundTxHash: string | undefined;
  if (fundAmount > 0) {
    try {
      fundTxHash = await fundAgentWallet({
        agentAddress: agentWallet.address,
        amountEth: fundEth,
      });
      const provider = getProvider();
      const receipt = await provider.waitForTransaction(fundTxHash);
      steps.push({
        step: "fund",
        ok: true,
        detail: `tx ${fundTxHash} (block ${receipt?.blockNumber ?? "?"})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ step: "fund", ok: false, detail: msg });
    }
  } else {
    steps.push({ step: "fund", ok: true, detail: "skipped (0 ETH)" });
  }

  // --- Persist config ---
  const config: AgentConfig = {
    name,
    description: `Agent ${name}`,
    walletAddress: agentWallet.address,
    walletChainId: getChainId(),
    endpoints: [],
    trustModels: [],
    owners: [masterWallet.address],
    operators: [agentWallet.address],
    active: true,
    x402support: false,
    metadata: {
      actions: selectedActions,
      tools: allToolNames,
    },
    createdAt: new Date().toISOString(),
    updatedAt: Math.floor(Date.now() / 1000),
  };

  try {
    saveAgentConfig(name, config);
    steps.push({ step: "config", ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to save config: ${msg}`, steps }, 500);
  }

  // --- Register ---
  if (!skipRegister) {
    try {
      const reg = await registerAgent({
        name: config.name,
        description: config.description,
        privateKey: agentWallet.privateKey,
        walletAddress: agentWallet.address,
        metadata: {
          actions: selectedActions,
          tools: allToolNames,
        },
      });
      config.agentId = reg.agentId;
      config.agentURI = reg.agentURI;
      config.updatedAt = Math.floor(Date.now() / 1000);
      saveAgentConfig(name, config);
      steps.push({ step: "register", ok: true, detail: String(reg.agentId) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ step: "register", ok: false, detail: msg });
    }
  } else {
    steps.push({ step: "register", ok: true, detail: "skipped" });
  }

  let balanceEth = "0";
  try {
    const bal = await getProvider().getBalance(agentWallet.address);
    balanceEth = ethers.formatEther(bal);
  } catch {
    /* ignore */
  }

  return c.json({
    ok: true,
    agent: publicAgentSummary(name),
    balanceEth,
    fundTxHash,
    steps,
  }, 201);
});

app.get("/api/agents/:name", (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ agent: publicAgentSummary(name) });
});

app.delete("/api/agents/:name", (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  if (process.env.VERCEL && !process.env.ALLOW_AGENT_DELETE) {
    return c.json(
      { error: "Agent deletion is disabled on Vercel (ephemeral filesystem). Delete env vars manually." },
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
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const summary = publicAgentSummary(name);
  if (!summary.walletAddress) {
    return c.json({ error: "Agent has no wallet address" }, 400);
  }

  let body: { amountEth?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.get("/api/agents/:name/memory", (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  try {
    const memory = readAgentMemory(name);
    return c.json(memory);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/agents/:name/chat", async (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  let body: { message?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  try {
    const result = await runChat(name, message);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/agents/:name/feedback", async (c) => {
  const name = c.req.param("name");
  if (!listExistingAgents().includes(name)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  let body: {
    agentId?: string;
    value?: unknown;
    tag?: string;
    endpoint?: string;
    comment?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Default target: the agent's own registered agentId.
  const summary = publicAgentSummary(name);
  const agentId = body.agentId?.trim() || summary.agentId;
  if (!agentId) {
    return c.json({ error: "agentId is required" }, 400);
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return c.json({ error: "value must be a number 0-100" }, 400);
  }

  try {
    const { giveFeedback } = await import("../core/reputation.js");
    const { getNetworkSlugByChainId, getChainId } = await import("../core/config.js");
    const result = await giveFeedback({
      agentId,
      value: body.value,
      // tag1 is forced to 'starred' in giveFeedback; body.tag is kept as tag2 context.
      tag: body.tag,
      endpoint: body.endpoint,
      comment: body.comment,
    });
    const chainId = summary.walletChainId ?? getChainId();
    let networkSlug = "arbitrum-sepolia";
    try {
      networkSlug = getNetworkSlugByChainId(chainId);
    } catch { /* keep default */ }
    const numericId = String(agentId).split(":").pop();
    const base = chainId === 42161 ? "https://8004scan.io" : "https://testnet.8004scan.io";
    return c.json({
      ok: true,
      ...result,
      scanUrl: `${base}/agents/${networkSlug}/${numericId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Missing signer is a client-config error, not a server crash.
    if (msg.includes("RATER_PRIVATE_KEY")) {
      return c.json({ error: msg }, 500);
    }
    return c.json({ error: msg }, 500);
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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

if (!process.env.VERCEL) {
  console.log(`web3agent API listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}

export default app;
