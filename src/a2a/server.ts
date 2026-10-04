// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal A2A JSON-RPC server with standalone x402 payment flow.
 *
 * This module owns the transport and the payment state machine. The work
 * itself is delegated to an `A2AExecutor`; without one the request is echoed.
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
import { A2A_PROTOCOL_VERSION } from "../core/registration-services.js"
import { MockFacilitatorClient } from "./mock-facilitator.js"
import {
  X402_EXTENSION_URI,
  X402_VERSION,
  type A2AMessage,
  type A2ATask,
  type AgentCard,
  type AgentCardSkill,
  type FacilitatorClient,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PaymentErrorCode,
  type PaymentRequirements,
  type SettlementReceipt,
  type TaskState,
} from "./types.js"
import {
  DEFAULT_PRICE_ATOMIC,
  MOCK_PAYMENT_NETWORK,
  buildAgentPaymentMetadata,
  buildPaymentRequirements,
  isX402ExtensionActivated,
  paymentPayloadFromMetadata,
  paymentStatusFromMetadata,
} from "./x402.js"

/** Tasks live in memory only; the oldest are evicted past this count. */
const MAX_TASKS = 1000

/** Does the actual work for a request and names it on the Agent Card. */
export interface A2AExecutor {
  skills: AgentCardSkill[]
  /** Resolves with the answer text; a rejection fails the task (and skips settlement). */
  run(text: string): Promise<string>
}

const ECHO_EXECUTOR: A2AExecutor = {
  skills: [{ id: "echo", name: "echo", description: "Echoes the message back", tags: ["default"] }],
  run: async (text) => text || "ok",
}

export interface A2AServerOptions {
  /** Public JSON-RPC URL of this server; used as AgentCard.url and payment resource. */
  endpointUrl: string
  /**
   * Agent identity and payment settings. x402 is on only when `x402support`
   * is set AND `walletAddress` is a valid address to pay to.
   */
  config: AgentConfig
  /** Defaults to an echo. */
  executor?: A2AExecutor
  /** Defaults to MockFacilitatorClient (payments simulated). */
  facilitator?: FacilitatorClient
}

interface StoredTask {
  task: A2ATask
  /** Set while/after the task went through the payment flow. */
  requirements?: PaymentRequirements
  serviceText: string
}

export class A2AServer {
  private readonly endpointUrl: string
  private readonly config: AgentConfig
  private readonly executor: A2AExecutor
  private readonly facilitator: FacilitatorClient
  private readonly tasks = new Map<string, StoredTask>()
  /** payTo address when x402 is on, otherwise undefined. */
  private readonly payTo: string | undefined

  constructor(options: A2AServerOptions) {
    this.endpointUrl = options.endpointUrl
    this.config = options.config
    this.executor = options.executor ?? ECHO_EXECUTOR
    this.facilitator = options.facilitator ?? new MockFacilitatorClient()
    const wallet = options.config.walletAddress ?? ""
    this.payTo =
      options.config.x402support && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet : undefined
  }

  buildAgentCard(): AgentCard {
    return {
      name: this.config.name,
      description: this.config.description || `Agent ${this.config.name}`,
      url: this.endpointUrl,
      version: "0.1.0",
      protocolVersion: A2A_PROTOCOL_VERSION,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        ...(this.payTo
          ? {
              extensions: [
                {
                  uri: X402_EXTENSION_URI,
                  description: "Supports payments using the x402 protocol for on-chain settlement.",
                  required: true,
                },
              ],
            }
          : {}),
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: this.executor.skills,
      supportsAuthenticatedExtendedCard: false,
    }
  }

  healthDescriptor(): Record<string, unknown> {
    return {
      name: this.config.name,
      protocol: "a2a",
      endpoint: "/api/a2a",
      agentCard: "/.well-known/agent-card.json",
      active: this.config.active !== false,
      x402support: Boolean(this.payTo),
      ...(this.payTo
        ? {
            x402: {
              facilitator: this.facilitator.name,
              network: MOCK_PAYMENT_NETWORK,
              payTo: this.payTo,
              maxAmountRequired: DEFAULT_PRICE_ATOMIC,
            },
          }
        : {}),
    }
  }

  /**
   * @param body Parsed JSON-RPC request.
   * @param extensionHeader Value of the `X-A2A-Extensions` request header.
   */
  async handleJsonRpc(body: unknown, extensionHeader?: string): Promise<JsonRpcResponse> {
    const req = body as Partial<JsonRpcRequest> | null
    if (!req || typeof req !== "object" || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return rpcError(req?.id, -32600, "Invalid Request")
    }
    const params = req.params ?? {}

    try {
      switch (req.method) {
        case "message/send": {
          const message = params.message as A2AMessage | undefined
          if (!message || typeof message !== "object" || !Array.isArray(message.parts)) {
            return rpcError(req.id, -32602, "Invalid params: params.message with parts[] is required")
          }
          return rpcResult(req.id, await this.handleMessageSend(message, extensionHeader))
        }
        case "tasks/get": {
          const taskId = typeof params.id === "string" ? params.id : ""
          const task = this.tasks.get(taskId)?.task
          if (!task) return rpcError(req.id, -32001, "Task not found", { taskId })
          return rpcResult(req.id, task)
        }
        default:
          return rpcError(req.id, -32601, `Method not found: ${req.method}`)
      }
    } catch (err) {
      return rpcError(req.id, -32000, errorMessage(err))
    }
  }

  private async handleMessageSend(
    message: A2AMessage,
    extensionHeader: string | undefined,
  ): Promise<A2ATask> {
    const contextId = message.contextId ?? randomUUID()
    if (this.config.active === false) {
      return this.createFailedTask(contextId, "Agent is inactive")
    }

    const status = paymentStatusFromMetadata(message.metadata)
    const isPaymentReply =
      status === "payment-rejected" ||
      status === "payment-submitted" ||
      paymentPayloadFromMetadata(message.metadata) !== undefined

    if (isPaymentReply) {
      const stored = message.taskId ? this.tasks.get(message.taskId) : undefined
      if (!stored) {
        return this.createFailedTask(contextId, "Unknown task for payment message", "UNKNOWN_TASK")
      }
      return status === "payment-rejected"
        ? this.rejectPayment(stored)
        : this.settlePayment(stored, message)
    }

    const text = message.parts
      .filter((p) => p.kind === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim()

    if (!this.payTo) {
      try {
        const answer = await this.executor.run(text)
        return this.store({
          task: agentTask(newTaskId(), contextId, "completed", answer),
          serviceText: text,
        })
      } catch (err) {
        return this.createFailedTask(contextId, `Agent failed: ${errorMessage(err)}`)
      }
    }
    if (!isX402ExtensionActivated(extensionHeader)) {
      return this.createFailedTask(
        contextId,
        "x402 extension required; activate via X-A2A-Extensions header",
        "EXTENSION_NOT_ACTIVATED",
      )
    }

    const requirements = buildPaymentRequirements({
      payTo: this.payTo,
      resource: this.endpointUrl,
      description: `Payment for: ${text.slice(0, 80) || "A2A skill"}`,
    })
    return this.store({
      task: agentTask(
        newTaskId(),
        contextId,
        "input-required",
        "Payment is required.",
        buildAgentPaymentMetadata({
          status: "payment-required",
          required: {
            x402Version: X402_VERSION,
            error: "Payment required to access this resource",
            accepts: [requirements],
          },
        }),
      ),
      requirements,
      serviceText: text,
    })
  }

  private rejectPayment(stored: StoredTask): A2ATask {
    const notAwaiting = this.notAwaitingPayment(stored)
    if (notAwaiting) return notAwaiting
    return this.update(
      stored,
      "failed",
      "Payment rejected by client.",
      buildAgentPaymentMetadata({ status: "payment-rejected", error: "PAYMENT_REJECTED" }),
    )
  }

  private async settlePayment(stored: StoredTask, message: A2AMessage): Promise<A2ATask> {
    const notAwaiting = this.notAwaitingPayment(stored)
    if (notAwaiting) return notAwaiting
    const requirements = stored.requirements!

    const payload = paymentPayloadFromMetadata(message.metadata)
    if (!payload) return this.fail(stored, "Missing x402.payment.payload", "INVALID_PAYMENT")

    // Leaving "input-required" before the first await makes a concurrent
    // submission for the same task bounce off notAwaitingPayment().
    this.update(
      stored,
      "working",
      "Verifying payment...",
      buildAgentPaymentMetadata({ status: "payment-submitted" }),
    )
    const verified = await this.facilitator.verify(payload, requirements)
    if (!verified.isValid) {
      return this.fail(
        stored,
        verified.invalidReason ?? "Payment verification failed",
        verified.errorCode ?? "INVALID_PAYMENT",
        {
          success: false,
          transaction: "",
          network: requirements.network,
          payer: verified.payer,
          errorReason: verified.invalidReason,
        },
      )
    }

    // Work happens between verify and settle: a failed run is never charged.
    this.update(
      stored,
      "working",
      "Payment verified. Working...",
      buildAgentPaymentMetadata({ status: "payment-verified" }),
    )
    let answer: string
    try {
      answer = await this.executor.run(stored.serviceText)
    } catch (err) {
      return this.fail(stored, `Agent failed, payment not settled: ${errorMessage(err)}`, "SERVER_ERROR")
    }

    const settled = await this.facilitator.settle(payload, requirements)
    const receipt: SettlementReceipt = {
      success: settled.success,
      transaction: settled.transaction ?? "",
      network: settled.network,
      payer: settled.payer,
      ...(settled.errorReason ? { errorReason: settled.errorReason } : {}),
    }
    if (!settled.success) {
      return this.fail(
        stored,
        settled.errorReason ?? "Settlement failed",
        settled.errorCode ?? "SETTLEMENT_FAILED",
        receipt,
      )
    }

    this.update(
      stored,
      "completed",
      answer,
      buildAgentPaymentMetadata({ status: "payment-completed", receipts: [receipt] }),
    )
    stored.task.artifacts = [
      { artifactId: randomUUID(), name: "result", parts: [{ kind: "text", text: answer }] },
    ]
    return stored.task
  }

  /**
   * Payment messages are only valid while the task waits for payment. Anything
   * else is answered with a failure that is NOT stored, so a late or duplicate
   * message can never overwrite a completed (paid) or in-flight task.
   */
  private notAwaitingPayment(stored: StoredTask): A2ATask | undefined {
    const { id, contextId, status } = stored.task
    if (stored.requirements && status.state === "input-required") return undefined
    const [text, error]: [string, PaymentErrorCode] =
      status.state === "completed"
        ? ["Payment already settled for this task", "DUPLICATE_PAYMENT"]
        : ["Task is not awaiting payment", "TASK_NOT_AWAITING_PAYMENT"]
    return agentTask(id, contextId, "failed", text, buildAgentPaymentMetadata({ status: "payment-failed", error }))
  }

  /** `error` is set for payment failures only; other failures carry no x402 metadata. */
  private createFailedTask(contextId: string, text: string, error?: PaymentErrorCode): A2ATask {
    return this.store({
      task: agentTask(
        newTaskId(),
        contextId,
        "failed",
        text,
        error ? buildAgentPaymentMetadata({ status: "payment-failed", error }) : undefined,
      ),
      serviceText: "",
    })
  }

  private fail(
    stored: StoredTask,
    text: string,
    error: PaymentErrorCode,
    receipt?: SettlementReceipt,
  ): A2ATask {
    return this.update(
      stored,
      "failed",
      text,
      buildAgentPaymentMetadata({
        status: "payment-failed",
        error,
        receipts: receipt ? [receipt] : undefined,
      }),
    )
  }

  private update(
    stored: StoredTask,
    state: TaskState,
    text: string,
    metadata: Record<string, unknown>,
  ): A2ATask {
    stored.task = agentTask(stored.task.id, stored.task.contextId, state, text, metadata)
    return stored.task
  }

  private store(stored: StoredTask): A2ATask {
    this.tasks.set(stored.task.id, stored)
    if (this.tasks.size > MAX_TASKS) {
      this.tasks.delete(this.tasks.keys().next().value!)
    }
    return stored.task
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function newTaskId(): string {
  return `task-${randomUUID()}`
}

function agentTask(
  id: string,
  contextId: string,
  state: TaskState,
  text: string,
  metadata?: Record<string, unknown>,
): A2ATask {
  return {
    kind: "task",
    id,
    contextId,
    status: {
      state,
      message: {
        kind: "message",
        role: "agent",
        messageId: randomUUID(),
        parts: [{ kind: "text", text }],
        ...(metadata ? { metadata } : {}),
      },
    },
  }
}

function rpcResult(id: JsonRpcRequest["id"] | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function rpcError(
  id: JsonRpcRequest["id"] | undefined,
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
