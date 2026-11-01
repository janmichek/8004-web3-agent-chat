import { ethers } from "ethers";
import type { Context } from "hono";
import { AGENT_NAME_RE } from "../../core/agent-path.js";
import { TOOL_REGISTRY, getActionByName } from "../../core/action-registry.js";
import { saveAgentConfig, type AgentConfig } from "../../core/agent-config.js";
import { getChainId, getProvider } from "../../core/config.js";
import { toGatewayUrl } from "../../core/ipfs.js";
import { registerAgent } from "../../core/registry.js";
import { canonicalizeEndpoint, isAdvertisableUrl } from "../../core/registration-services.js";
import {
  getAgentWalletEnvVars,
  getMasterWallet,
  getOrCreateAgentWallet,
} from "../../core/wallet.js";
import { agentExists, publicAgentSummary } from "../agent-catalog.js";
import { errMsg, readJsonBody } from "../http-utils.js";
import { serializeTurn } from "../signing-key.js";

export async function createAgentHandler(c: Context) {
  const body = await readJsonBody<{
    name?: string;
    owner?: string;
    description?: string;
    imageUri?: string;
    actions?: string[];
    tools?: string[];
    oasfDomains?: string[];
    oasfSkills?: string[];
    skipRegister?: boolean;
    active?: boolean;
    services?: { name?: string; endpoint?: string }[];
    mcpEndpoint?: string;
    a2aEndpoint?: string;
    x402support?: boolean;
  }>(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }
  if (!AGENT_NAME_RE.test(name)) {
    return c.json(
      {
        error: "name must be 1–63 chars: letters, numbers, . _ - (start with alphanumeric)",
      },
      400,
    );
  }
  if (agentExists(name)) {
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

  // Creation never moves master funds: the done step calls POST /fund. Creating
  // an agent is anonymous, so letting it fund would let anyone spend the master wallet.
  const skipRegister = Boolean(body.skipRegister);
  const active = body.active !== false;
  const rawServices = body.services ?? [
    { name: "web", endpoint: "https://example.com" },
    { name: "email", endpoint: "e@mail.fun" },
  ];
  if (!Array.isArray(rawServices)) {
    return c.json({ error: "services must be an array" }, 400);
  }
  // Shorthand: `mcpEndpoint` / `a2aEndpoint` append services unless already declared.
  for (const [shorthandName, shorthandEndpoint] of [
    ["mcp", body.mcpEndpoint],
    ["A2A", body.a2aEndpoint],
  ] as const) {
    const endpoint = shorthandEndpoint?.trim();
    const declared = rawServices.some(
      (s) =>
        typeof s?.name === "string" && s.name.trim().toLowerCase() === shorthandName.toLowerCase(),
    );
    if (endpoint && !declared) rawServices.push({ name: shorthandName, endpoint });
  }
  const x402support = body.x402support === true;
  if (rawServices.length > 20) {
    return c.json({ error: "services must have at most 20 entries" }, 400);
  }
  // Stored with canonical names (MCP/A2A/...) and the well-known Agent Card
  // URL for A2A, i.e. exactly what registration later pins for 8004scan.
  const endpoints: { type: string; value: string }[] = [];
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
    const { type, value } = canonicalizeEndpoint({ type: svcName, value: svcEndpoint });
    const lower = type.toLowerCase();
    if (seenServiceNames.has(lower)) {
      return c.json({ error: `duplicate service: ${svcName}` }, 400);
    }
    seenServiceNames.add(lower);
    // MCP/A2A/web endpoints must be https URLs so 8004scan can verify them.
    // Email keeps its legacy free-form value (e@mail.fun). http is allowed for
    // localhost/127.0.0.1 so local dev (`http://localhost:5173/api/mcp`) can be advertised.
    if ((lower === "mcp" || lower === "a2a" || lower === "web") && !isAdvertisableUrl(value)) {
      return c.json({ error: `${type} endpoint must be an https:// URL` }, 400);
    }
    endpoints.push({ type, value });
  }
  // x402 is the payment step of the A2A flow; without an A2A endpoint the
  // on-chain x402Support flag would promise something nobody can call.
  if (x402support && !seenServiceNames.has("a2a")) {
    return c.json({ error: "x402support requires an A2A endpoint" }, 400);
  }
  const description = body.description?.trim() || `Agent ${name}`;
  let imageUri = body.imageUri?.trim();
  if (imageUri && !/^(https?:\/\/|ipfs:\/\/)/i.test(imageUri)) {
    return c.json({ error: "imageUri must be an https:// or ipfs:// URI" }, 400);
  }
  // Normalize ipfs:// to https gateway so on-chain metadata `image` is resolvable.
  if (imageUri) imageUri = toGatewayUrl(imageUri);

  // Creation is authenticated by the signed-in wallet: its address becomes
  // the identity NFT owner and is recorded in the pinned registration file.
  const owner = body.owner?.trim();
  if (!owner) {
    return c.json({ error: "owner is required — connect and sign in with a wallet" }, 400);
  }
  if (!ethers.isAddress(owner)) {
    return c.json({ error: "owner must be a valid wallet address" }, 400);
  }

  let masterWallet: ReturnType<typeof getMasterWallet>;
  try {
    masterWallet = getMasterWallet();
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: `Master wallet unavailable: ${msg}` }, 500);
  }

  // --- Create wallet ---
  // Resolve inside the turn queue: `getOrCreateAgentWallet` falls back to the
  // ambient AGENT_PRIVATE_KEY, which a concurrent chat turn may have set.
  let agentWallet: ReturnType<typeof getOrCreateAgentWallet>;
  try {
    agentWallet = await serializeTurn(async () => getOrCreateAgentWallet({ agentName: name }));
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: `Wallet creation failed: ${msg}` }, 500);
  }

  // --- Persist config ---
  const config: AgentConfig = {
    name,
    description,
    image: imageUri || undefined,
    walletAddress: agentWallet.address,
    walletChainId: getChainId(),
    endpoints: endpoints as AgentConfig["endpoints"],
    trustModels: [],
    owners: [owner],
    operators: [agentWallet.address],
    active,
    x402support,
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
  } catch (err) {
    const msg = errMsg(err);
    return c.json({ error: `Failed to save config: ${msg}` }, 500);
  }

  // --- Register ---
  if (!skipRegister) {
    try {
      const reg = await registerAgent({
        name: config.name,
        description: config.description,
        privateKey: masterWallet.privateKey,
        owner,
        walletAddress: agentWallet.address,
        agentWalletPrivateKey: agentWallet.privateKey,
        active,
        endpoints,
        x402support,
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
    } catch {
      // Registration failure is non-fatal: the config is saved and the agent
      // can be registered later.
    }
  }

  let balanceEth = "0";
  try {
    const bal = await getProvider().getBalance(agentWallet.address);
    balanceEth = ethers.formatEther(bal);
  } catch {
    /* ignore */
  }

  // Without an env var backing this agent, the wallet+config live only
  // in /tmp (ephemeral). Return the private key ONCE so the browser can
  // keep a local backup and heal cold instances via /restore.
  const walletEnvVar = getAgentWalletEnvVars(name)[0]!;
  const ephemeral = Boolean(process.env.VERCEL) && !process.env[walletEnvVar];

  return c.json(
    {
      ok: true,
      agent: await publicAgentSummary(name),
      balanceEth,
      ...(ephemeral
        ? {
            ephemeral: true,
            privateKey: agentWallet.privateKey,
            privateKeyEnvVar: walletEnvVar,
            // Full config so the browser can keep a local backup and heal
            // cold serverless instances via POST /api/agents/:name/restore.
            config,
            ephemeralWarning: `Save this private key as ${walletEnvVar} in Vercel env vars now — the /tmp wallet is lost on cold start/redeploy and the agent will stop working.`,
          }
        : {}),
    },
    201,
  );
}
