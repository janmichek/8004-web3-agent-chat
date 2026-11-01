import { timingSafeEqual } from "node:crypto";
import { loadAgentConfig } from "../core/agent-config.js";
import { runWithNetwork } from "../core/config.js";
import { agentNetwork } from "./agent-catalog.js";
import { checkRateLimit, getClientIp, RATE_LIMITED } from "./http-utils.js";

const MCP_RATE_MAX = Number(process.env.MCP_RATE_MAX || 60);

function mcpAuthOk(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const expected = process.env.MCP_AUTH_TOKEN?.trim();
  if (!expected) return false; // fail closed — set MCP_AUTH_TOKEN
  const got =
    c.req
      .header("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** JSON-RPC methods that only discover capabilities — safe without auth. */
const MCP_OPEN_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
]);

/**
 * Decide whether a POST to /api/mcp executes something (→ Bearer required)
 * or is pure discovery (→ open so 8004scan / MCP clients can handshake).
 * Unknown / unparsable bodies fail closed (auth required).
 */
async function mcpPostNeedsAuth(c: McpContext): Promise<boolean> {
  if (c.req.method !== "POST") return true;
  let body: unknown;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    return true; // unparsable → fail closed
  }
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0) return true;
  for (const m of messages) {
    if (typeof m !== "object" || m === null) return true;
    const method = (m as { method?: unknown }).method;
    if (typeof method !== "string") return true; // response/error → not a discovery call
    if (method.startsWith("notifications/")) continue;
    if (MCP_OPEN_METHODS.has(method)) continue;
    return true; // tools/call and everything else → auth
  }
  return false;
}

let mcpHandlerCache: ((req: Request) => Promise<Response>) | null = null;
async function getMcpHandler(
  allowedTools?: string[],
): Promise<(req: Request) => Promise<Response>> {
  // Unscoped handler is cached; per-agent scoped handlers are built per request.
  if (!allowedTools && mcpHandlerCache) return mcpHandlerCache;
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
  const { getMcpServer } = await import("../mcp/server.js");
  const handler = async (req: Request) => {
    const server = getMcpServer(allowedTools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — fresh per request
    });
    await server.connect(transport);
    // Stateless: new transport per request; do not close here — the
    // Response's SSE stream stays open until the client disconnects.
    // The transport will be GC'd after the stream ends.
    return transport.handleRequest(req);
  };
  if (!allowedTools) mcpHandlerCache = handler;
  return handler;
}

// 8004scan verifies `services[].endpoint` with a plain GET health check (no
// `Accept: text/event-stream`), while real MCP clients use POST. The SDK's
// transport returns 406 for that GET, which shows as "Unhealthy" on 8004scan.
// So: answer GET with a minimal 200 JSON descriptor (no tool list — avoids
// recon). Discovery POSTs (initialize / notifications / ping / */list) are
// open so verifiers can handshake; anything that executes (tools/call and
// everything else) requires Bearer auth + rate-limit.
export type McpContext = {
  req: {
    raw: Request;
    method: string;
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
  json: (data: unknown, status?: number) => Response;
};

export async function handleMcp(c: McpContext) {
  if (c.req.method === "GET") {
    return Response.json(
      {
        name: "web3agent",
        version: "0.1.0",
        protocol: "mcp",
        transport: "streamable-http",
        endpoint: "/api/mcp",
        auth: "bearer",
        usage:
          "Discovery (initialize, tools/list) is open; tools/call requires Authorization: Bearer $MCP_AUTH_TOKEN with Accept: application/json, text/event-stream",
      },
      { status: 200, headers: { "access-control-allow-origin": "*" } },
    );
  }
  // Discovery methods anyone may call (handshake + capability listing).
  // Everything else executes or reads data → gated behind Bearer auth.
  const needsAuth = await mcpPostNeedsAuth(c);
  if (needsAuth) {
    if (!process.env.MCP_AUTH_TOKEN?.trim()) {
      return c.json({ error: "MCP is not configured (missing MCP_AUTH_TOKEN)" }, 503);
    }
    if (!checkRateLimit(`mcp:${getClientIp(c)}`, MCP_RATE_MAX)) {
      return c.json({ error: RATE_LIMITED }, 429);
    }
    if (!mcpAuthOk(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  // Optional per-agent scope: POST /api/mcp?agent=my-agent serves only that
  // agent's creation-time `metadata.tools` allowlist. Unknown agent → 404
  // instead of falling back to all tools.
  const agentName = c.req.query("agent")?.trim();
  let allowedTools: string[] | undefined;
  if (agentName) {
    const { getAgentToolAllowlist } = await import("../mcp/server.js");
    const allowlist = await getAgentToolAllowlist(agentName);
    if (!allowlist) return c.json({ error: `Unknown agent: ${agentName}` }, 404);
    allowedTools = allowlist;
  }
  const handler = await getMcpHandler(allowedTools);
  if (!agentName) return handler(c.req.raw);
  // Agent-scoped tool calls act on that agent's chain.
  return runWithNetwork(agentNetwork(loadAgentConfig(agentName)), () => handler(c.req.raw));
}
