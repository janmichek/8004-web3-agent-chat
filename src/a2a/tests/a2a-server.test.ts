/**
 * Separate A2A transport edge cases (free path + protocol errors, no payment).
 *
 * Run: npx vitest run src/a2a/tests/a2a-server.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { A2AServer } from "../server.js"
import type { AgentConfig } from "../../core/agent-config.js"
import { X402_EXTENSION_URI } from "../types.js"

const ENDPOINT_URL = "http://localhost:8787/api/a2a"

function freeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "free-agent",
    description: "Free A2A agent",
    walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    endpoints: [{ type: "A2A", value: "http://localhost:8787/api/a2a" }],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: { actions: ["transfer-eth"], tools: ["get_token_balance"] },
    createdAt: new Date().toISOString(),
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

describe("A2AServer (transport only)", () => {
  let server: A2AServer

  beforeEach(() => {
    server = new A2AServer({ endpointUrl: ENDPOINT_URL, config: freeConfig() })
  })

  it("builds agent card without x402 extension when disabled", () => {
    const card = server.buildAgentCard()
    expect(card.name).toBe("free-agent")
    expect(card.url).toBe(ENDPOINT_URL)
    expect(card.skills.length).toBeGreaterThan(0)
    expect(card.capabilities.extensions).toBeUndefined()
  })

  it("health descriptor reports x402support false", () => {
    expect(server.healthDescriptor().x402support).toBe(false)
  })

  it("rejects invalid JSON-RPC envelope", async () => {
    expect((await server.handleJsonRpc({ foo: 1 })).error?.code).toBe(-32600)
    expect((await server.handleJsonRpc("nope")).error?.code).toBe(-32600)
    expect((await server.handleJsonRpc(null)).error?.code).toBe(-32600)
  })

  it("rejects message/send without a message", async () => {
    const res = await server.handleJsonRpc({ jsonrpc: "2.0", id: 7, method: "message/send" })
    expect(res.id).toBe(7)
    expect(res.error?.code).toBe(-32602)
  })

  it("rejects unknown method", async () => {
    const res = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "nope/method",
    })
    expect(res.error?.code).toBe(-32601)
  })

  it("message/send completes free task without payment", async () => {
    const res = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: "r1",
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: "hello free" }],
        },
      },
    })
    const task = res.result as {
      id: string
      contextId: string
      status: { state: string; message: { parts: { text: string }[] } }
    }
    expect(res.error).toBeUndefined()
    expect(task.contextId).toBeTruthy()
    expect(task.status.state).toBe("completed")
    expect(task.status.message.parts[0]?.text).toContain("hello free")
  })

  it("tasks/get returns existing and errors for unknown", async () => {
    const created = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: "ping" }],
        },
      },
    })
    const id = (created.result as { id: string }).id
    const got = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { id },
    })
    expect((got.result as { id: string }).id).toBe(id)

    const missing = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/get",
      params: { id: "task-missing" },
    })
    expect(missing.error?.code).toBe(-32001)
  })

  it("rejects inactive agent", async () => {
    server = new A2AServer({ endpointUrl: ENDPOINT_URL, config: freeConfig({ active: false }) })
    const res = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: "hi" }],
        },
      },
    })
    const task = res.result as {
      status: { state: string; message: { parts: { text: string }[]; metadata?: unknown } }
    }
    expect(task.status.state).toBe("failed")
    expect(task.status.message.parts[0]?.text).toBe("Agent is inactive")
    // Not a payment failure: no x402 metadata on a free agent.
    expect(task.status.message.metadata).toBeUndefined()
  })

  const hello = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: { message: { kind: "message", role: "user", parts: [{ kind: "text", text: "hi" }] } },
  }
  type TextTask = { status: { state: string; message: { parts: { text: string }[] } } }

  it("delegates the work to the executor and advertises its skills", async () => {
    const run = vi.fn(async (text: string) => `answer to ${text}`)
    server = new A2AServer({
      endpointUrl: ENDPOINT_URL,
      config: freeConfig(),
      executor: { skills: [{ id: "chat", name: "chat", description: "Ask me" }], run },
    })
    expect(server.buildAgentCard().skills.map((s) => s.id)).toEqual(["chat"])
    const task = (await server.handleJsonRpc(hello)).result as TextTask
    expect(run).toHaveBeenCalledWith("hi")
    expect(task.status.state).toBe("completed")
    expect(task.status.message.parts[0]?.text).toBe("answer to hi")
  })

  it("a failing executor fails the task instead of the RPC call", async () => {
    server = new A2AServer({
      endpointUrl: ENDPOINT_URL,
      config: freeConfig(),
      executor: { skills: [], run: async () => { throw new Error("LLM down") } },
    })
    const res = await server.handleJsonRpc(hello)
    expect(res.error).toBeUndefined()
    const task = res.result as TextTask
    expect(task.status.state).toBe("failed")
    expect(task.status.message.parts[0]?.text).toContain("LLM down")
  })

  it("x402support without a payable wallet stays free", async () => {
    server = new A2AServer({
      endpointUrl: ENDPOINT_URL,
      config: freeConfig({ x402support: true, walletAddress: undefined }),
    })
    expect(server.buildAgentCard().capabilities.extensions).toBeUndefined()
    expect(server.healthDescriptor().x402support).toBe(false)
    expect(((await server.handleJsonRpc(hello)).result as TextTask).status.state).toBe("completed")
  })

  it("echo is the default skill; health names the facilitator when paid", () => {
    expect(server.buildAgentCard().skills.map((s) => s.id)).toEqual(["echo"])
    const paid = new A2AServer({ endpointUrl: ENDPOINT_URL, config: freeConfig({ x402support: true }) })
    expect(paid.healthDescriptor().x402).toMatchObject({ facilitator: "mock", network: "base-sepolia" })
  })

  it("agent card includes x402 extension when enabled", () => {
    server = new A2AServer({ endpointUrl: ENDPOINT_URL, config: freeConfig({ x402support: true }) })
    const card = server.buildAgentCard()
    expect(card.capabilities.extensions?.[0]?.uri).toBe(X402_EXTENSION_URI)
    expect(card.capabilities.extensions?.[0]?.required).toBe(true)
  })
})
