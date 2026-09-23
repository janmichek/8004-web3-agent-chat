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
  getAgentWalletEnvVars,
  getMasterWalletBalance,
  getMasterWallet,
  getOrCreateAgentWallet,
} from "../core/wallet.js";
import { resolveAgentSkills } from "../core/agent-skills.js";
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
import {
  persistAgentToStore,
  listStoredAgents,
  hydrateAgentFromStore,
  deleteAgentFromStore,
} from "../core/agent-store.js";
import { registerAgent } from "../core/registry.js";
import { hasIpfsBackend, toGatewayUrl, uploadImage, validateImage } from "../core/ipfs.js";
import { readAgentMemory } from "../core/memory-reader.js";
import type { Skill } from "../actions/types.js";

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);

// --- MCP (stateless, all tools) ------------------------------------------------
// Served at /api/mcp and /mcp so `${origin}/api/mcp` (prefilled in wizard) is verifiable on 8004scan.
// Uses WebStandard transport so it works on Vercel (Web Fetch) and local Hono (Node) alike.
let mcpHandler: ((req: Request) => Promise<Response>) | null = null;
async function getMcpHandler(): Promise<(req: Request) => Promise<Response>> {
  if (mcpHandler) return mcpHandler;
  const { WebStandardStreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
  );
  const { getMcpServer } = await import("../mcp/server.js");
  mcpHandler = async (req: Request) => {
    const server = getMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — fresh per request
    });
    await server.connect(transport);
    // Stateless: new transport per request; do not close here — the
    // Response's SSE stream stays open until the client disconnects.
    // The transport will be GC'd after the stream ends.
    return transport.handleRequest(req);
  };
  return mcpHandler;
}

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

function listExistingAgentsSync(): string[] {
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

async function listExistingAgents(): Promise<string[]> {
  const names = new Set(listExistingAgentsSync());
  // Merge KV-persisted agents (cold instances with empty /tmp)
  for (const n of await listStoredAgents()) names.add(n);
  return [...names];
}

/**
 * Ensure a KV-persisted agent is hydrated to /tmp so the synchronous
 * filesystem paths below keep working on cold serverless instances.
 * Returns true when the agent exists (after hydration if needed).
 *
 * NOTE: hydration must happen *before* any sync config/wallet read —
 * the KV index merge alone is not enough, since it would report the
 * agent as existing while /tmp is still empty, and
 * getOrCreateAgentWallet would then generate the WRONG wallet.
 */
async function ensureAgentLoaded(name: string): Promise<boolean> {
  // Fast path: present on local filesystem or env vars.
  if (listExistingAgentsSync().includes(name)) return true;
  // Cold instance: hydrate from KV (writes /tmp files), then re-check.
  await hydrateAgentFromStore(name);
  return (await listExistingAgents()).includes(name);
}

async function publicAgentSummary(name: string) {
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
    oasfDomains: (config?.metadata?.oasfDomains as string[] | undefined) ?? [],
    oasfSkills: (config?.metadata?.oasfSkills as string[] | undefined) ?? [],
    active: config?.active ?? true,
    endpoints: config?.endpoints ?? [],
    services: (config?.endpoints ?? []).map((e) => ({ name: e.type, endpoint: e.value })),
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
    allowHeaders: ["Content-Type", "Accept", "mcp-session-id", "mcp-protocol-version", "Last-Event-ID"],
    exposeHeaders: ["mcp-session-id"],
  }),
);

// --- MCP: expose tools over Streamable HTTP at /api/mcp (and /mcp for legacy) ---
// 8004scan verifies `services[].endpoint` by fetching the MCP URL, so this must be reachable.
app.all("/api/mcp", async (c) => {
  const handler = await getMcpHandler();
  return handler(c.req.raw);
});
app.all("/mcp", async (c) => {
  const handler = await getMcpHandler();
  return handler(c.req.raw);
});

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

app.get("/api/agents", async (c) => {
  const names = await listExistingAgents();
  const agents = await Promise.all(names.map(publicAgentSummary));
  return c.json({ agents });
});

/** Optional image upload (multipart) → pinned to IPFS, returns https gateway URL. */
app.post("/api/upload/image", async (c) => {
  if (!hasIpfsBackend()) {
    return c.json(
      { error: "No IPFS backend configured (set PINATA_JWT or IPFS_NODE_URL)" },
      503,
    );
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

app.post("/api/agents", async (c) => {
  let body: {
    name?: string;
    description?: string;
    imageUri?: string;
    actions?: string[];
    tools?: string[];
    oasfDomains?: string[];
    oasfSkills?: string[];
    fundEth?: string;
    skipRegister?: boolean;
    active?: boolean;
    services?: { name?: string; endpoint?: string }[];
    mcpEndpoint?: string;
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
  if ((await listExistingAgents()).includes(name)) {
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

  // OASF domains/skills (optional, stored in metadata + on-chain registration)
  const oasfDomains = Array.isArray(body.oasfDomains) ? body.oasfDomains : [];
  const oasfSkills = Array.isArray(body.oasfSkills) ? body.oasfSkills : [];
  const oasfIdRe = /^[0-9]{1,6}$/;
  for (const id of [...oasfDomains, ...oasfSkills]) {
    if (typeof id !== "string" || !oasfIdRe.test(id)) {
      return c.json({ error: `Invalid OASF id: ${String(id)}` }, 400);
    }
  }
  if (oasfDomains.length > 18 || oasfSkills.length > 200) {
    return c.json({ error: "Too many OASF domains/skills selected" }, 400);
  }

  // Funding happens post-creation from the done step (master or connected
  // wallet), so creation itself does not fund. fundEth stays accepted for
  // API/CLI backward compatibility when explicitly passed.
  const fundEth = (body.fundEth?.trim() || "0");
  const fundAmount = Number(fundEth);
  if (!Number.isFinite(fundAmount) || fundAmount < 0 || fundAmount > 1) {
    return c.json({ error: "fundEth must be a number between 0 and 1" }, 400);
  }

  const skipRegister = Boolean(body.skipRegister);
  const active = body.active !== false;
  const rawServices = body.services ?? [
    { name: "web", endpoint: "https://example.com" },
    { name: "email", endpoint: "e@mail.fun" },
  ];
  if (!Array.isArray(rawServices)) {
    return c.json({ error: "services must be an array" }, 400);
  }
  // Shorthand: `mcpEndpoint: "https://host/mcp"` appends an mcp service
  // unless services already declares one (case-insensitive).
  const mcpEndpoint = body.mcpEndpoint?.trim();
  if (mcpEndpoint) {
    const hasMcp = rawServices.some(
      (s) => typeof s?.name === "string" && s.name.trim().toLowerCase() === "mcp",
    );
    if (!hasMcp) rawServices.push({ name: "mcp", endpoint: mcpEndpoint });
  }
  if (rawServices.length > 20) {
    return c.json({ error: "services must have at most 20 entries" }, 400);
  }
  const services: { name: string; endpoint: string }[] = [];
  const seenServiceNames = new Set<string>();
  for (const entry of rawServices) {
    const svcName = entry?.name?.trim();
    const svcEndpoint = entry?.endpoint?.trim();
    if (!svcName || !svcEndpoint) {
      return c.json({ error: "each service needs a name and an endpoint" }, 400);
    }
    if (svcName.length > 64 || svcEndpoint.length > 500) {
      return c.json({ error: "service name (max 64) or endpoint (max 500) too long" }, 400);
    }
    const lower = svcName.toLowerCase();
    if (seenServiceNames.has(lower)) {
      return c.json({ error: `duplicate service: ${svcName}` }, 400);
    }
    seenServiceNames.add(lower);
    // MCP/A2A/web endpoints must be https URLs so 8004scan can verify them.
    // Email keeps its legacy free-form value (e@mail.fun). Allow http for
    // localhost/127.0.0.1 so local dev (`http://localhost:5173/api/mcp`) can be advertised.
    if (lower === "mcp" || lower === "a2a" || lower === "web") {
      const isHttps = /^https:\/\/.+/i.test(svcEndpoint);
      const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/.+/i.test(svcEndpoint);
      if (!isHttps && !isLocalHttp) {
        return c.json({ error: `${svcName} endpoint must be an https:// URL` }, 400);
      }
    }
    services.push({ name: svcName, endpoint: svcEndpoint });
  }
  const endpoints = services.map((s) => ({ type: s.name, value: s.endpoint })) as AgentConfig["endpoints"];
  const description = body.description?.trim() || `Agent ${name}`;
  let imageUri = body.imageUri?.trim();
  if (imageUri && !/^(https?:\/\/|ipfs:\/\/)/i.test(imageUri)) {
    return c.json({ error: "imageUri must be an https:// or ipfs:// URI" }, 400);
  }
  // Normalize ipfs:// to https gateway so on-chain metadata `image` is resolvable.
  if (imageUri) imageUri = toGatewayUrl(imageUri);
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
    steps.push({ step: "fund", ok: true, detail: "skipped — fund after creation" });
  }

  // --- Persist config ---
  const config: AgentConfig = {
    name,
    description,
    image: imageUri || undefined,
    walletAddress: agentWallet.address,
    walletChainId: getChainId(),
    endpoints,
    trustModels: [],
    owners: [masterWallet.address],
    operators: [agentWallet.address],
    active,
    x402support: false,
    metadata: {
      actions: selectedActions,
      tools: allToolNames,
      oasfDomains,
      oasfSkills,
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

  // --- Persist to KV (seamless across serverless instances) ---
  // Best-effort: no-op when KV is not bound. Re-saved after registration
  // below so agentId/agentURI are included.
  await persistAgentToStore(name, config, agentWallet);

  // --- Register ---
  if (!skipRegister) {
    try {
      const reg = await registerAgent({
        name: config.name,
        description: config.description,
        privateKey: masterWallet.privateKey,
        walletAddress: agentWallet.address,
        agentWalletPrivateKey: agentWallet.privateKey,
        active,
        endpoints,
        metadata: {
          actions: selectedActions,
          tools: allToolNames,
          oasfDomains,
          oasfSkills,
        },
        ...(imageUri ? { image: imageUri } : {}),
      });
      config.agentId = reg.agentId;
      config.agentURI = reg.agentURI;
      config.metadata.updatedAt = reg.updatedAt;
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

  // Re-persist after registration so agentId/agentURI survive cold starts.
  await persistAgentToStore(name, config, agentWallet);

  let balanceEth = "0";
  try {
    const bal = await getProvider().getBalance(agentWallet.address);
    balanceEth = ethers.formatEther(bal);
  } catch {
    /* ignore */
  }

  // Without KV or an env var backing this agent, the wallet+config live only
  // in /tmp (ephemeral). Return the private key ONCE so the user can save it
  // as AGENT_<SUFFIX>_PRIVATE_KEY in Vercel env vars before a cold start.
  // With KV bound the agent is seamless — no manual step needed.
  const walletEnvVar = getAgentWalletEnvVars(name)[0]!;
  const ephemeral =
    Boolean(process.env.VERCEL) && !process.env[walletEnvVar] && !process.env.KV_REST_API_URL;

  return c.json({
    ok: true,
    agent: await publicAgentSummary(name),
    balanceEth,
    fundTxHash,
    steps,
    ...(ephemeral
      ? {
          ephemeral: true,
          privateKey: agentWallet.privateKey,
          privateKeyEnvVar: walletEnvVar,
          ephemeralWarning: `Save this private key as ${walletEnvVar} in Vercel env vars now — the /tmp wallet is lost on cold start/redeploy and the agent will stop working.`,
        }
      : {}),
  }, 201);
});

app.get("/api/agents/:name", async (c) => {
  const name = c.req.param("name");
  if (!(await ensureAgentLoaded(name))) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ agent: await publicAgentSummary(name) });
});

app.delete("/api/agents/:name", async (c) => {
  const name = c.req.param("name");
  if (!(await ensureAgentLoaded(name))) {
    return c.json({ error: "Agent not found" }, 404);
  }
  if (process.env.VERCEL && !process.env.ALLOW_AGENT_DELETE && !process.env.KV_REST_API_URL) {
    return c.json(
      { error: "Agent deletion is disabled on Vercel (ephemeral filesystem). Delete env vars manually." },
      403,
    );
  }
  const removed = deleteAgentConfig(name);
  await deleteAgentFromStore(name);
  if (!removed) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({ ok: true, name });
});

app.post("/api/agents/:name/fund", async (c) => {
  const name = c.req.param("name");
  if (!(await ensureAgentLoaded(name))) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const summary = await publicAgentSummary(name);
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

app.get("/api/agents/:name/memory", async (c) => {
  const name = c.req.param("name");
  if (!(await ensureAgentLoaded(name))) {
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
  if (!(await ensureAgentLoaded(name))) {
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
  if (!(await ensureAgentLoaded(name))) {
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
  const summary = await publicAgentSummary(name);
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
