// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal A2A JSON-RPC server with standalone x402 payment flow (mock facilitator).
 *
 * Endpoints (mounted by api.ts):
 *   GET  /api/a2a                      → health / descriptor
 *   GET  /.well-known/agent-card.json  → AgentCard
 *   POST /api/a2a                      → JSON-RPC (message/send, tasks/get)
 *
 * @module a2a/server
 */

import { randomUUID } from "node:crypto"
import type { AgentConfig } from "../core/agent-config.js"
import { MockFacilitatorClient } from "./mock-facilitator.js"
import {
  X402_EXTENSION_URI,
  type A2AMessage,
  type A2ATask,
  type AgentCard,
  type FacilitatorClient,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PaymentRequirements,
  type SettlementReceipt,
} from "./types.js"
import {
  DEFAULT_PRICE_ATOMIC,
  buildAgentPaymentMetadata,
  buildPaymentRequiredResponse,
  buildPaymentRequirements,
  isX402ExtensionActivated,
  paymentPayloadFromMetadata,
  paymentStatusFromMetadata,
} from "./x402.js"

export interface A2AServerOptions {
  /** Public base URL used in AgentCard.url (e.g. https://host or http://localhost:8787). */
  publicBaseUrl: string
  /** Agent config driving skills + x402 + wallet payTo. */
  config: AgentConfig
  /** Injectable facilitator (defaults to MockFacilitatorClient). */
  facilitator?: FacilitatorClient
  /** Override price in atomic units. */
  priceAtomic?: string
  /** Resource URL embedded in payment requirements. */
  resourceUrl?: string
  /** When true (default if config.x402support), monetized skills require payment. */
  x402Enabled?: boolean
  /** When true (default), reject monetized calls without X-A2A-Extensions. */
  requireExtensionHeader?: boolean
}

interface StoredTask {
  task: A2ATask
  requirements?: PaymentRequirements
  paid: boolean
  serviceText?: string
}

export class A2AServer {
  readonly publicBaseUrl: string
  readonly config: AgentConfig
  readonly facilitator: FacilitatorClient
  readonly priceAtomic: string
  readonly resourceUrl: string
  readonly x402Enabled: boolean
  readonly requireExtensionHeader: boolean
  private readonly tasks = new Map<string, StoredTask>()

  constructor(options: A2AServerOptions) {
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "")
    this.config = options.config
    this.facilitator = options.facilitator ?? new MockFacilitatorClient()
    this.priceAtomic = options.priceAtomic ?? DEFAULT_PRICE_ATOMIC
    this.resourceUrl = options.resourceUrl ?? `${this.publicBaseUrl}/api/a2a`
    this.x402Enabled = options.x402Enabled ?? Boolean(options.config.x402support)
    this.requireExtensionHeader = options.requireExtensionHeader ?? true
  }

  /** Clear in-memory tasks (tests). */
  reset(): void {
    this.tasks.clear()
  }

  getTask(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId)?.task
  }

  buildAgentCard(): AgentCard {
    const tools = this.config.metadata?.tools ?? []
    const actions = this.config.metadata?.actions ?? []
    const skills = [
      ...actions.map((name) => ({
        id: `action:${name}`,
        name,
        description: `Action: ${name}`,
        tags: ["action"],
      })),
      ...tools.map((name) => ({
        id: `tool:${name}`,
        name,
        description: `Tool: ${name}`,
        tags: ["tool"],
      })),
    ]
    if (skills.length === 0) {
      skills.push({
        id: "echo",
        name: "echo",
        description: "Echo a message (default skill)",
        tags: ["default"],
      })
    }

    const extensions = this.x402Enabled
      ? [
          {
            uri: X402_EXTENSION_URI,
            description: "Supports payments using the x402 protocol for on-chain settlement.",
            required: true,
          },
        ]
      : undefined

    return {
      name: this.config.name,
      description: this.config.description || `Agent ${this.config.name}`,
      url: `${this.publicBaseUrl}/api/a2a`,
      version: "0.1.0",
      protocolVersion: "0.3.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        ...(extensions ? { extensions } : {}),
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills,
      supportsAuthenticatedExtendedCard: false,
    }
  }

  healthDescriptor(): Record<string, unknown> {
    return {
      name: this.config.name,
      protocol: "a2a",
      endpoint: "/api/a2a",
      agentCard: "/.well-known/agent-card.json",
      x402support: this.x402Enabled,
      active: this.config.active !== false,
    }
  }

  async handleJsonRpc(
    body: unknown,
    headers: { extensionHeader?: string } = {},
  ): Promise<JsonRpcResponse> {
    if (!body || typeof body !== "object") {
      return rpcError(null, -32700, "Parse error")
    }
    const req = body as JsonRpcRequest
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return rpcError(req.id ?? null, -32600, "Invalid Request")
    }

    try {
      switch (req.method) {
        case "message/send":
          return rpcResult(
            req.id,
            await this.handleMessageSend(req.params ?? {}, headers.extensionHeader),
          )
        case "tasks/get": {
          const taskId = String((req.params as { id?: string })?.id ?? "")
          const task = this.tasks.get(taskId)?.task
          if (!task) return rpcError(req.id, -32001, "Task not found", { taskId })
          return rpcResult(req.id, task)
        }
        case "agent/getAuthenticatedExtendedCard":
          return rpcResult(req.id, this.buildAgentCard())
        default:
          return rpcError(req.id, -32601, `Method not found: ${req.method}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return rpcError(req.id ?? null, -32000, msg)
    }
  }

  private async handleMessageSend(
    params: Record<string, unknown>,
    extensionHeader?: string,
  ): Promise<A2ATask> {
    if (this.config.active === false) {
      return this.failNewTask("Agent is inactive", "AGENT_INACTIVE")
    }

    const message = (params.message ?? params) as A2AMessage
    if (!message || typeof message !== "object") {
      throw new Error("params.message is required")
    }

    const text = extractText(message)
    const taskId = message.taskId ?? (typeof params.taskId === "string" ? params.taskId : undefined)
    const status = paymentStatusFromMetadata(message.metadata)

    // Client explicitly rejected payment terms.
    if (status === "payment-rejected") {
      if (!taskId || !this.tasks.has(taskId)) {
        return this.failNewTask("Payment rejected (unknown task)", "UNKNOWN_TASK")
      }
      return this.markRejected(taskId)
    }

    // Payment submission path.
    if (status === "payment-submitted" || paymentPayloadFromMetadata(message.metadata)) {
      if (!taskId || !this.tasks.has(taskId)) {
        return this.failNewTask("Unknown task for payment submission", "UNKNOWN_TASK")
      }
      return this.handlePaymentSubmission(taskId, message)
    }

    // New service request — may require payment.
    if (this.x402Enabled) {
      if (this.requireExtensionHeader && !isX402ExtensionActivated(extensionHeader)) {
        return this.failNewTask(
          "x402 extension required; activate via X-A2A-Extensions header",
          "EXTENSION_NOT_ACTIVATED",
        )
      }
      return this.createPaymentRequiredTask(text)
    }

    return this.completeFreeTask(text)
  }

  private createPaymentRequiredTask(userText: string): A2ATask {
    const payTo =
      this.config.walletAddress || "0x0000000000000000000000000000000000000001"
    const requirements = buildPaymentRequirements({
      payTo,
      resource: this.resourceUrl,
      description: `Payment for: ${userText.slice(0, 80) || "A2A skill"}`,
      amount: this.priceAtomic,
    })
    const required = buildPaymentRequiredResponse([requirements])
    const id = `task-${randomUUID()}`
    const task: A2ATask = {
      kind: "task",
      id,
      status: {
        state: "input-required",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: "Payment is required." }],
          metadata: buildAgentPaymentMetadata({
            status: "payment-required",
            required,
          }),
        },
      },
    }
    this.tasks.set(id, {
      task,
      requirements,
      paid: false,
      serviceText: userText,
    })
    return task
  }

  private async handlePaymentSubmission(
    taskId: string,
    message: A2AMessage,
  ): Promise<A2ATask> {
    const stored = this.tasks.get(taskId)!
    if (stored.paid) {
      return this.updateFailed(
        stored,
        "Payment already settled for this task",
        "DUPLICATE_PAYMENT",
      )
    }
    if (!stored.requirements || stored.task.status.state !== "input-required") {
      return this.updateFailed(
        stored,
        "Task is not awaiting payment",
        "TASK_NOT_AWAITING_PAYMENT",
      )
    }

    const payload = paymentPayloadFromMetadata(message.metadata)
    if (!payload) {
      return this.updateFailed(stored, "Missing x402.payment.payload", "INVALID_PAYMENT")
    }

    // Mark submitted → working while verifying.
    stored.task = {
      ...stored.task,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: "Verifying payment..." }],
          metadata: buildAgentPaymentMetadata({ status: "payment-submitted" }),
        },
      },
    }

    const verified = await this.facilitator.verify(payload, stored.requirements)
    if (!verified.isValid) {
      return this.updateFailed(
        stored,
        verified.invalidReason ?? "Payment verification failed",
        verified.errorCode ?? "INVALID_PAYMENT",
        [
          {
            success: false,
            transaction: "",
            network: stored.requirements.network,
            payer: verified.payer,
            errorReason: verified.invalidReason,
          },
        ],
      )
    }

    stored.task = {
      ...stored.task,
      status: {
        state: "working",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: "Payment verified. Settling..." }],
          metadata: buildAgentPaymentMetadata({ status: "payment-verified" }),
        },
      },
    }

    const settled = await this.facilitator.settle(payload, stored.requirements)
    if (!settled.success) {
      return this.updateFailed(
        stored,
        settled.errorReason ?? "Settlement failed",
        settled.errorCode ?? "SETTLEMENT_FAILED",
        [
          {
            success: false,
            transaction: settled.transaction ?? "",
            network: settled.network,
            payer: settled.payer,
            errorReason: settled.errorReason,
          },
        ],
      )
    }

    const receipt: SettlementReceipt = {
      success: true,
      transaction: settled.transaction ?? "",
      network: settled.network,
      payer: settled.payer,
    }
    const resultText = `Paid service result: ${stored.serviceText || "ok"}`
    stored.paid = true
    stored.task = {
      kind: "task",
      id: taskId,
      status: {
        state: "completed",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: resultText }],
          metadata: buildAgentPaymentMetadata({
            status: "payment-completed",
            receipts: [receipt],
          }),
        },
      },
      artifacts: [
        {
          kind: "text",
          name: "result",
          mimeType: "text/plain",
          parts: [{ kind: "text", text: resultText }],
        },
      ],
    }
    return stored.task
  }

  private markRejected(taskId: string): A2ATask {
    const stored = this.tasks.get(taskId)!
    stored.task = {
      kind: "task",
      id: taskId,
      status: {
        state: "failed",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: "Payment rejected by client." }],
          metadata: buildAgentPaymentMetadata({
            status: "payment-rejected",
            error: "PAYMENT_REJECTED",
          }),
        },
      },
    }
    return stored.task
  }

  private completeFreeTask(userText: string): A2ATask {
    const id = `task-${randomUUID()}`
    const task: A2ATask = {
      kind: "task",
      id,
      status: {
        state: "completed",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: `Free service result: ${userText || "ok"}` }],
        },
      },
    }
    this.tasks.set(id, { task, paid: true, serviceText: userText })
    return task
  }

  private failNewTask(text: string, error: string): A2ATask {
    const id = `task-${randomUUID()}`
    const task: A2ATask = {
      kind: "task",
      id,
      status: {
        state: "failed",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text }],
          metadata: buildAgentPaymentMetadata({
            status: "payment-failed",
            error,
          }),
        },
      },
    }
    this.tasks.set(id, { task, paid: false })
    return task
  }

  private updateFailed(
    stored: StoredTask,
    text: string,
    error: string,
    receipts?: SettlementReceipt[],
  ): A2ATask {
    stored.task = {
      kind: "task",
      id: stored.task.id,
      status: {
        state: "failed",
        message: {
          kind: "message",
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text }],
          metadata: buildAgentPaymentMetadata({
            status: "payment-failed",
            error,
            receipts,
          }),
        },
      },
    }
    return stored.task
  }
}

function extractText(message: A2AMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts
    .filter((p) => p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
    .trim()
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  }
}

/** Factory used by the HTTP API with optional per-agent config. */
export function createA2AServer(options: A2AServerOptions): A2AServer {
  return new A2AServer(options)
}
