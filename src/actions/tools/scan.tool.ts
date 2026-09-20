// SPDX-License-Identifier: Apache-2.0

import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"

function scanBase(): string {
  return process.env.SCAN_API_BASE || "https://testnet.8004scan.io/api/v1"
}

function scanHeaders(): Record<string, string> {
  const key = process.env.SCAN_API_KEY || ""
  return {
    "Content-Type": "application/json",
    // 8004scan docs mention X-Access-Token (MCP dialog) and X-API-Key (curl example);
    // send all accepted variants so either server config works.
    "X-Access-Token": key,
    "X-API-Key": key,
    Authorization: `Bearer ${key}`,
  }
}

async function scanGet(path: string): Promise<string> {
  const key = process.env.SCAN_API_KEY
  if (!key) {
    return "Error: SCAN_API_KEY environment variable is not set (get one at https://testnet.8004scan.io)"
  }
  try {
    const res = await fetch(`${scanBase()}${path}`, { headers: scanHeaders() })
    const text = await res.text()
    if (!res.ok) {
      return `Error: 8004scan ${res.status} ${text.slice(0, 300)}`
    }
    // Truncate: agent listings can be large, keep LLM context sane.
    return text.length > 4000 ? text.slice(0, 4000) + "\n...[truncated]" : text
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error: ${message.slice(0, 300)}`
  }
}

/**
 * @notice Search ERC-8004 agents by keyword (or semantic similarity).
 * Use this before interacting with an unknown agent to discover candidates.
 */
export const searchAgentsTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "search_agents",
  description:
    "Search ERC-8004 agents on 8004scan by keyword. " +
    "Returns matching agents with IDs (e.g. '421614:204'). " +
    "Use get_agent for details and get_agent_feedbacks for reputation before transacting.",
  schema: z.object({
    query: z.string().describe("Search query, e.g. 'defi yield'"),
    chain_id: z.string().optional().describe("Filter by chain ID, e.g. '421614'"),
    limit: z.number().optional().describe("Max results (default 10)"),
    search_type: z.string().optional().describe("'keyword' or 'semantic' (default keyword)"),
  }),
  func: async ({ query, chain_id, limit, search_type }): Promise<string> => {
    const params = new URLSearchParams({ query })
    if (chain_id) params.set("chain_id", chain_id)
    if (limit) params.set("limit", String(limit))
    if (search_type) params.set("search_type", search_type)
    return scanGet(`/agents?${params.toString()}`)
  },
})

/** @notice Get detailed info about a specific ERC-8004 agent. */
export const getScanAgentTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "get_agent",
  description:
    "Get detailed information about a specific ERC-8004 agent from 8004scan " +
    "(owner, endpoints, registration, metadata).",
  schema: z.object({
    agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
  }),
  func: async ({ agentId }): Promise<string> => {
    return scanGet(`/agents/${encodeURIComponent(agentId)}`)
  },
})

/** @notice Get off-chain feedbacks/reviews for an agent from 8004scan. */
export const getScanAgentFeedbacksTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "get_agent_feedbacks",
  description:
    "Get feedbacks/reviews for an ERC-8004 agent from 8004scan. " +
    "Use together with get_reputation (onchain) to decide whether to trust an agent.",
  schema: z.object({
    agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
    limit: z.number().optional().describe("Max feedbacks (default 10)"),
  }),
  func: async ({ agentId, limit }): Promise<string> => {
    const suffix = limit ? `?limit=${limit}` : ""
    return scanGet(`/agents/${encodeURIComponent(agentId)}/feedbacks${suffix}`)
  },
})
