// SPDX-License-Identifier: Apache-2.0

/**
 * MCP server wrapping the existing in-process LangChain tools.
 *
 * Same execution logic — different transport. Each MCP tool delegates to
 * the matching DynamicStructuredTool via `.invoke()`, so behavior stays
 * identical to the chat / API path.
 *
 * Usage:
 *   npx tsx src/mcp/server.ts                         # stdio (Claude Desktop, MCP clients)
 *   npx tsx src/mcp/server.ts --http                  # Streamable HTTP on MCP_PORT (default 8788)
 *   npx tsx src/mcp/server.ts --agent my-agent        # only expose my-agent's selected tools
 *   MCP_AGENT=my-agent npx tsx src/mcp/server.ts --http
 *
 * Per-agent filtering is how creation-time actions/tools selections flow
 * into MCP: each agent's `metadata.tools` becomes the tool allowlist, so
 * the advertised MCP endpoint only serves what was selected in the wizard.
 * Without --agent / MCP_AGENT, all tools are exposed (backward compat).
 *
 * Advertise a remote instance on ERC-8004 via:
 *   agent.setMCP("https://you/mcp")  (or endpoints: [{ type: "MCP", value: ... }])
 *
 * @module mcp/server
 */

import * as http from "node:http"
import { timingSafeEqual } from "node:crypto"
import dotenv from "dotenv"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import {
  sendEthTool,
  tokenBalanceTool,
  fetchContractAbiTool,
  callContractTool,
} from "../actions/tools/index.js"
import { giveFeedbackTool, getReputationTool } from "../actions/tools/feedback.tool.js"
import {
  searchAgentsTool,
  getScanAgentTool,
  getScanAgentFeedbacksTool,
} from "../actions/tools/scan.tool.js"

dotenv.config()

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

/** @notice Build a fresh MCP server with web3agent tools registered.
 *
 * @param allowedTools - Optional allowlist of tool names to expose. When
 * omitted, all tools are registered (backward compat). Pass an agent's
 * `metadata.tools` to serve exactly what was selected at creation time.
 */
export function getMcpServer(allowedTools?: string[]): McpServer {
  const allow = allowedTools ? new Set(allowedTools) : undefined
  const enabled = (name: string): boolean => !allow || allow.has(name)
  const server = new McpServer({ name: "web3agent", version: "0.1.0" })

  if (enabled("send_eth")) {
  server.registerTool(
    "send_eth",
    {
      description:
        "Send ETH from the agent wallet to a destination address. Returns tx hash or error.",
      inputSchema: {
        to: z.string().describe("Destination wallet address (0x...)"),
        amount: z.string().describe("Amount of ETH, e.g. '0.01'"),
      },
    },
    async ({ to, amount }) => textResult(await sendEthTool.invoke({ to, amount })),
  )
  }

  if (enabled("get_token_balance")) {
  server.registerTool(
    "get_token_balance",
    {
      description:
        "Check ETH or ERC-20 balance. Omit address for agent wallet, omit tokenAddress for native ETH.",
      inputSchema: {
        address: z.string().optional().describe("Wallet address to check"),
        tokenAddress: z.string().optional().describe("ERC-20 contract address"),
      },
    },
    async ({ address, tokenAddress }) =>
      textResult(await tokenBalanceTool.invoke({ address, tokenAddress })),
  )
  }

  if (enabled("fetch_contract_abi")) {
  server.registerTool(
    "fetch_contract_abi",
    {
      description:
        "Fetch a verified contract's ABI. Returns callable functions with signatures.",
      inputSchema: {
        address: z.string().describe("Contract address (0x...)"),
      },
    },
    async ({ address }) => textResult(await fetchContractAbiTool.invoke({ address })),
  )
  }

  if (enabled("call_contract")) {
  server.registerTool(
    "call_contract",
    {
      description:
        "Call a verified contract function. Reads return result, writes return tx hash. Use fetch_contract_abi first.",
      inputSchema: {
        address: z.string().describe("Contract address (0x...)"),
        functionName: z.string().describe("Exact function name"),
        args: z
          .string()
          .optional()
          .describe("JSON array of args, e.g. '[\"0x...\", \"100\"]'"),
      },
    },
    async ({ address, functionName, args }) =>
      textResult(await callContractTool.invoke({ address, functionName, args })),
  )
  }

  if (enabled("give_feedback")) {
  server.registerTool(
    "give_feedback",
    {
      description:
        "Rate an ERC-8004 agent 0-100 after a transaction. Stored with tag1='starred'.",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
        value: z.number().describe("Rating 0-100"),
        tag: z.string().optional().describe("Interaction context, e.g. 'transfer'"),
        endpoint: z.string().optional().describe("Endpoint the rating applies to"),
        comment: z.string().optional().describe("Short review comment"),
      },
    },
    async ({ agentId, value, tag, endpoint, comment }) =>
      textResult(
        await giveFeedbackTool.invoke({ agentId, value, tag, endpoint, comment }),
      ),
  )
  }

  if (enabled("get_reputation")) {
  server.registerTool(
    "get_reputation",
    {
      description: "Get an ERC-8004 agent's reputation summary (count + average 0-100).",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
        tag: z.string().optional().describe("Optional tag filter"),
      },
    },
    async ({ agentId, tag }) =>
      textResult(await getReputationTool.invoke({ agentId, tag })),
  )
  }

  if (enabled("search_agents")) {
  server.registerTool(
    "search_agents",
    {
      description:
        "Search ERC-8004 agents on 8004scan by keyword. Returns IDs like '421614:204'.",
      inputSchema: {
        query: z.string().describe("Search query, e.g. 'defi yield'"),
        chain_id: z.string().optional().describe("Filter by chain ID, e.g. '421614'"),
        limit: z.number().optional().describe("Max results (default 10)"),
        search_type: z.string().optional().describe("'keyword' or 'semantic'"),
      },
    },
    async ({ query, chain_id, limit, search_type }) =>
      textResult(await searchAgentsTool.invoke({ query, chain_id, limit, search_type })),
  )
  }

  if (enabled("get_agent")) {
  server.registerTool(
    "get_agent",
    {
      description: "Get detailed 8004scan info about a specific ERC-8004 agent.",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
      },
    },
    async ({ agentId }) => textResult(await getScanAgentTool.invoke({ agentId })),
  )
  }

  if (enabled("get_agent_feedbacks")) {
  server.registerTool(
    "get_agent_feedbacks",
    {
      description: "Get 8004scan feedbacks/reviews for an ERC-8004 agent.",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
        limit: z.number().optional().describe("Max feedbacks (default 10)"),
      },
    },
    async ({ agentId, limit }) =>
      textResult(await getScanAgentFeedbacksTool.invoke({ agentId, limit })),
  )
  }

  return server
}

/** @notice Resolve an agent's selected tool names from its persisted config.
 *
 * Returns undefined when the agent has no config (caller should expose all
 * tools), or the `metadata.tools` allowlist otherwise.
 */
export async function getAgentToolAllowlist(agentName: string): Promise<string[] | undefined> {
  const { loadAgentConfig } = await import("../core/agent-config.js")
  const config = loadAgentConfig(agentName)
  if (!config) return undefined
  return [...new Set(config.metadata?.tools ?? [])]
}

function resolveAgentName(): string | undefined {
  const idx = process.argv.indexOf("--agent")
  const fromFlag = idx !== -1 ? process.argv[idx + 1]?.trim() : undefined
  const fromEnv = process.env.MCP_AGENT?.trim()
  return fromFlag || fromEnv || undefined
}

async function runStdio(): Promise<void> {
  const agentName = resolveAgentName()
  const allowlist = agentName ? await getAgentToolAllowlist(agentName) : undefined
  const server = getMcpServer(allowlist)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  const scope = agentName ? `agent "${agentName}" (${allowlist?.length ?? 0} tools)` : "9 tools"
  console.error(`[mcp] web3agent MCP server running on stdio (${scope})`)
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

function mcpHttpAuthOk(req: http.IncomingMessage): boolean {
  const expected = process.env.MCP_AUTH_TOKEN?.trim()
  if (!expected) return false // fail closed — set MCP_AUTH_TOKEN
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!got || got.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

async function runHttp(): Promise<void> {
  const port = Number(process.env.MCP_PORT || 8788)
  const agentName = resolveAgentName()
  const allowlist = agentName ? await getAgentToolAllowlist(agentName) : undefined
  if (!process.env.MCP_AUTH_TOKEN?.trim()) {
    console.error("[mcp] MCP_AUTH_TOKEN is not set — POST /mcp will return 503 (fail closed)")
  }
  const srv = http.createServer(async (req, res) => {
    const url = (req.url ?? "").split("?")[0]
    if (url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Not found, use POST /mcp" }))
      return
    }
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          name: "web3agent",
          protocol: "mcp",
          transport: "streamable-http",
          endpoint: "/mcp",
          auth: "bearer",
        }),
      )
      return
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Use POST /mcp for MCP requests" }))
      return
    }
    if (!process.env.MCP_AUTH_TOKEN?.trim()) {
      res.writeHead(503, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "MCP is not configured (missing MCP_AUTH_TOKEN)" }))
      return
    }
    if (!mcpHttpAuthOk(req)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "unauthorized" }))
      return
    }
    const server = getMcpServer(allowlist)
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: new transport per request
      })
      await server.connect(transport)
      const body = await readJsonBody(req)
      await transport.handleRequest(req, res, body)
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
    } catch (err) {
      console.error("[mcp] request error:", err)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
      void server.close()
    }
  })
  srv.listen(port, () => {
    const scope = agentName ? `agent "${agentName}" (${allowlist?.length ?? 0} tools)` : "all tools"
    console.log(`[mcp] web3agent MCP server listening on http://localhost:${port}/mcp (${scope})`)
  })
}

async function main(): Promise<void> {
  if (process.argv.includes("--http")) {
    await runHttp()
  } else {
    await runStdio()
  }
}

main().catch((err) => {
  console.error(`[mcp] fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
