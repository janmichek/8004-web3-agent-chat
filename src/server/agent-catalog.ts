import * as fs from "node:fs";
import * as path from "node:path";
import { ethers } from "ethers";
import { TOOL_REGISTRY } from "../core/action-registry.js";
import { loadAgentConfig, type AgentConfig } from "../core/agent-config.js";
import { findNetworkByChainId, getDefaultNetwork, getNetworkConfig } from "../core/config.js";
import { toGatewayUrl } from "../core/ipfs.js";
import { readAgentMemoryAsync } from "../core/memory-reader.js";
import type { NetworkName } from "../core/types.js";
import { AGENTS_DIR } from "../core/wallet.js";

/** How A2A payments are handled: real facilitator when configured, simulated otherwise. */
export function x402Mode(): "mock" | "facilitator" {
  return process.env.X402_FACILITATOR_URL?.trim() ? "facilitator" : "mock";
}

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
          } catch {
            /* ignore */
          }
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

export function listExistingAgents(): string[] {
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

/**
 * Check the agent exists on this instance's filesystem or env vars.
 * Cold Vercel instances heal via POST /api/agents/:name/restore
 * (browser-held backup + retry in the frontend), not via shared storage.
 */
export function agentExists(name: string): boolean {
  return listExistingAgents().includes(name);
}

export async function publicAgentSummary(name: string, withUsage = false) {
  const config = loadAgentConfig(name);
  let walletAddress: string | undefined = config?.walletAddress;
  // Try env private key first
  if (!walletAddress) {
    const envPk = process.env[`AGENT_${agentEnvSuffix(name)}_PRIVATE_KEY`];
    if (envPk) {
      try {
        walletAddress = new ethers.Wallet(envPk).address;
      } catch {
        /* ignore */
      }
    }
  }
  if (!walletAddress) {
    const candidates = [path.join(AGENTS_DIR, name, "wallet.json")];
    if (process.env.VERCEL)
      candidates.push(path.join(path.resolve(process.cwd(), "agents"), name, "wallet.json"));
    for (const walletPath of candidates) {
      if (!fs.existsSync(walletPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as { address?: string };
        walletAddress = raw.address;
        break;
      } catch {
        /* ignore */
      }
    }
  }

  const usage = withUsage ? await readAgentMemoryAsync(name).catch(() => null) : null;

  return {
    name,
    description: config?.description ?? `Agent ${name}`,
    image: config?.image ? toGatewayUrl(config.image) : undefined,
    walletAddress,
    walletChainId: config?.walletChainId ?? getNetworkConfig().chainId,
    agentId: config?.agentId,
    agentURI: config?.agentURI,
    owners: config?.owners ?? [],
    operators: config?.operators ?? [],
    actions: config?.metadata?.actions ?? [],
    tools: config?.metadata?.tools ?? [],
    oasfDomains: (config?.metadata?.oasfDomains as string[] | undefined) ?? [],
    oasfSkills: (config?.metadata?.oasfSkills as string[] | undefined) ?? [],
    active: config?.active ?? true,
    x402support: config?.x402support ?? false,
    ...(config?.x402support ? { x402Mode: x402Mode() } : {}),
    endpoints: config?.endpoints ?? [],
    services: (config?.endpoints ?? []).map((e) => ({ name: e.type, endpoint: e.value })),
    ...(usage
      ? {
          lastActive: usage.lastActive,
          messageCount: usage.stats.totalMessages,
          sessionCount: usage.sessions.length,
        }
      : {}),
  };
}

/** Network an agent lives on: its `walletChainId`, else the NETWORK default (legacy configs). */
export function agentNetwork(config: AgentConfig | null | undefined): NetworkName {
  const network = config?.walletChainId ? findNetworkByChainId(config.walletChainId) : undefined;
  return network ?? getDefaultNetwork();
}

/** Tool names an anonymous A2A caller may trigger: read-only ones the agent was given. */
export function a2aToolNames(config: AgentConfig): string[] {
  const readOnly = new Set(TOOL_REGISTRY.filter((t) => t.readOnly).map((t) => t.name));
  return (config.metadata?.tools ?? []).filter((t) => readOnly.has(t));
}
