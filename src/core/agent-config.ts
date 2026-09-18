// SPDX-License-Identifier: Apache-2.0

/**
 * ERC-8004 compliant agent configuration.
 *
 * The persisted agent-config.json follows the RegistrationFile schema from
 * the ERC-8004 Identity Registry, with tool/action selection stored in the
 * `metadata` field so it round-trips through the SDK without data loss.
 *
 * @module agent-config
 */

import * as fs from "node:fs"
import * as path from "node:path"
import type { DynamicStructuredTool } from "@langchain/core/tools"
import { AGENTS_DIR } from "./wallet.js"
import { ACTION_REGISTRY, TOOL_REGISTRY, getStandaloneToolInstance } from "./action-registry.js"
import type { Skill } from "../actions/types.js"

// ---------------------------------------------------------------------------
// ERC-8004 aligned types
// ---------------------------------------------------------------------------

/** @notice Endpoint type as defined in ERC-8004. */
export type EndpointType = "MCP" | "A2A" | "ENS" | "DID" | "wallet" | "OASF"

/** @notice An agent communication endpoint. */
export interface Endpoint {
  type: EndpointType
  value: string
  meta?: Record<string, unknown>
}

/**
 * @notice ERC-8004 compliant agent configuration.
 *
 * Mirrors the RegistrationFile interface from @blockbyvlog/agent0-sdk.
 * Tool/action selection is stored under `metadata.actions` and
 * `metadata.tools` so the file is both ERC-8004 compliant
 * and usable by the local tool-resolution pipeline.
 */
export interface AgentConfig {
  // --- Identity (ERC-8004 core) ---
  agentId?: string
  agentURI?: string
  name: string
  description: string
  image?: string

  // --- Wallet ---
  walletAddress?: string
  walletChainId?: number

  // --- Communication ---
  endpoints: Endpoint[]

  // --- Trust & governance ---
  trustModels: string[]
  owners: string[]
  operators: string[]

  // --- Status ---
  active: boolean
  x402support: boolean

  // --- Metadata (tool/action config lives here) ---
  metadata: {
    actions: string[]
    tools: string[]
    [key: string]: unknown
  }

  // --- Timestamps ---
  createdAt: string
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Helpers for Vercel env injection
// ---------------------------------------------------------------------------

function agentEnvSuffix(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_")
}

function getAgentConfigEnvName(agentName: string): string {
  return `AGENT_${agentEnvSuffix(agentName)}_CONFIG`
}

function parseAgentConfigEnv(agentName: string): AgentConfig | null {
  const envName = getAgentConfigEnvName(agentName)
  const raw = process.env[envName]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed as AgentConfig
  } catch {
    console.warn(`[config] Invalid JSON in ${envName}`)
    return null
  }
}

function normalizeConfig(parsed: Record<string, unknown>): AgentConfig {
  if (parsed.actions && !(parsed as Record<string, unknown>).metadata) {
    return migrateLegacyConfig(parsed)
  }
  if ((parsed as Record<string, unknown>).metadata && (parsed as unknown as AgentConfig).metadata?.standaloneTools && !(parsed as unknown as AgentConfig).metadata?.tools) {
    const m = (parsed as unknown as AgentConfig).metadata as unknown as Record<string, unknown>
    m.tools = m.standaloneTools as string[]
    delete m.standaloneTools
  }
  return parsed as unknown as AgentConfig
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** @notice Write agent config to disk. */
export function saveAgentConfig(agentName: string, config: AgentConfig): void {
  // On Vercel, also mirror to /tmp and warn that env should be used for persistence
  try {
    const agentDir = path.join(AGENTS_DIR, agentName)
    fs.mkdirSync(agentDir, { recursive: true })
    const configPath = path.join(agentDir, "agent-config.json")
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
  } catch (err) {
    if (process.env.VERCEL) {
      console.warn(`[config] Vercel write failed, set ${getAgentConfigEnvName(agentName)} instead:`, err)
    } else {
      throw err
    }
  }
}

/** @notice Read agent config from disk. Returns null if not found. */
export function loadAgentConfig(agentName: string): AgentConfig | null {
  // 1) Env var takes precedence on Vercel
  const fromEnv = parseAgentConfigEnv(agentName)
  if (fromEnv) return normalizeConfig(fromEnv as unknown as Record<string, unknown>)

  // 2) Try filesystem in AGENTS_DIR (/tmp on Vercel) and fallback to cwd/agents
  const candidates = [AGENTS_DIR]
  if (process.env.VERCEL) candidates.push(path.resolve(process.cwd(), "agents"))
  for (const dir of candidates) {
    const configPath = path.join(dir, agentName, "agent-config.json")
    if (!fs.existsSync(configPath)) continue
    try {
      const raw = fs.readFileSync(configPath, "utf-8")
      const parsed = JSON.parse(raw)
      return normalizeConfig(parsed)
    } catch { /* ignore */ }
  }
  return null
}

/** @notice Delete agent directory (config, wallet, memory). Returns true if anything was removed. */
export function deleteAgentConfig(agentName: string): boolean {
  let removed = false
  const candidates = [AGENTS_DIR]
  if (process.env.VERCEL) candidates.push(path.resolve(process.cwd(), "agents"))
  for (const dir of candidates) {
    const agentDir = path.join(dir, agentName)
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true })
      removed = true
    }
  }
  return removed
}

/** @notice Migrate pre-ERC-8004 configs to the new schema. */
function migrateLegacyConfig(legacy: Record<string, unknown>): AgentConfig {
  return {
    name: (legacy.name as string) ?? "",
    description: "",
    walletAddress: "",
    walletChainId: undefined,
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {
      actions: (legacy.actions as string[]) ?? [],
      tools: (legacy.standaloneTools as string[]) ?? (legacy.tools as string[]) ?? [],
    },
    createdAt: (legacy.createdAt as string) ?? new Date().toISOString(),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

// ---------------------------------------------------------------------------
// Tool / skill resolution
// ---------------------------------------------------------------------------

/** @notice Resolved tools and skills from an agent config. */
export interface ResolvedConfig {
  tools: DynamicStructuredTool[]
  skills: Skill[]
}

/** @notice Materialize an agent config into runtime tools and skills. */
export function resolveToolsFromConfig(config: AgentConfig): ResolvedConfig {
  const resolvedTools: DynamicStructuredTool[] = []
  const skills: Skill[] = []
  const addedToolNames = new Set<string>()

  const actions = config.metadata?.actions ?? []
  const toolNames = config.metadata?.tools ?? []

  // Actions, each provides tools + a skill
  for (const actionName of actions) {
    const entry = ACTION_REGISTRY.find((a) => a.name === actionName)
    if (!entry) continue
    const action = entry.factory()
    skills.push(action.skill)
    for (const tool of action.tools) {
      if (!addedToolNames.has(tool.name)) {
        resolvedTools.push(tool)
        addedToolNames.add(tool.name)
      }
    }
  }

  // Remaining tools from the tools list, skip duplicates already added by actions
  for (const toolName of toolNames) {
    if (addedToolNames.has(toolName)) continue
    const instance = getStandaloneToolInstance(toolName)
    if (instance) {
      resolvedTools.push(instance)
      addedToolNames.add(toolName)
    }
  }

  return { tools: resolvedTools, skills }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @notice Build a human-readable capability summary from the config. */
export function buildCapabilitySummary(config: AgentConfig): string {
  const actions = config.metadata?.actions ?? []
  const tools = config.metadata?.tools ?? []

  const lines: string[] = []

  if (actions.length > 0) {
    for (const actionName of actions) {
      const entry = ACTION_REGISTRY.find((a) => a.name === actionName)
      if (entry) {
        lines.push(`- ${entry.name}: ${entry.description} [tools: ${entry.toolNames.join(", ")}]`)
      }
    }
  }

  if (tools.length > 0) {
    for (const toolName of tools) {
      const entry = TOOL_REGISTRY.find((t) => t.name === toolName)
      if (entry) {
        lines.push(`- ${entry.name}: ${entry.description}`)
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No capabilities configured."
}
