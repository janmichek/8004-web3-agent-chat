// SPDX-License-Identifier: Apache-2.0

/**
 * A2A + x402 payment types (standalone flow, mock-friendly).
 *
 * Spec refs:
 * - https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2/spec.md
 * - https://github.com/coinbase/x402/blob/main/specs/transports-v2/a2a.md
 *
 * @module a2a/types
 */

/** Canonical x402 A2A extension URI (v0.2). */
export const X402_EXTENSION_URI =
  "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2"

/** Legacy URI still accepted for activation (v0.1). */
export const X402_EXTENSION_URI_LEGACY =
  "https://github.com/google-a2a/a2a-x402/v0.1"

export const X402_VERSION = 1

export type PaymentStatus =
  | "payment-required"
  | "payment-rejected"
  | "payment-submitted"
  | "payment-verified"
  | "payment-completed"
  | "payment-failed"

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"

export type PaymentErrorCode =
  | "EXTENSION_NOT_ACTIVATED"
  | "INVALID_PAYMENT"
  | "EXPIRED_PAYMENT"
  | "WRONG_AMOUNT"
  | "WRONG_PAYEE"
  | "WRONG_NETWORK"
  | "WRONG_ASSET"
  | "INSUFFICIENT_FUNDS"
  | "INVALID_SIGNATURE"
  | "UNKNOWN_TASK"
  | "TASK_NOT_AWAITING_PAYMENT"
  | "DUPLICATE_PAYMENT"
  | "PAYMENT_REJECTED"
  | "SETTLEMENT_FAILED"
  | "SERVER_ERROR"

export interface PaymentRequirements {
  scheme: "exact"
  network: string
  maxAmountRequired: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  description: string
  resource: string
  mimeType: string
  extra?: Record<string, unknown>
}

export interface X402PaymentRequiredResponse {
  x402Version: number
  error?: string
  accepts: PaymentRequirements[]
}

export interface PaymentAuthorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}

export interface PaymentPayload {
  x402Version: number
  scheme: "exact"
  network: string
  asset?: string
  payload: {
    signature: string
    authorization: PaymentAuthorization
  }
}

export interface SettlementReceipt {
  success: boolean
  transaction: string
  network: string
  payer?: string
  errorReason?: string
}

export interface VerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  errorCode?: PaymentErrorCode
}

export interface SettleResponse {
  success: boolean
  transaction?: string
  network: string
  payer?: string
  errorReason?: string
  errorCode?: PaymentErrorCode
}

export interface FacilitatorClient {
  /** Shown in the health descriptor: "mock" or the facilitator URL. */
  readonly name: string
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>
}

export interface A2APart {
  kind: "text" | "data"
  text?: string
  data?: unknown
}

export interface A2AMessage {
  kind: "message"
  role: "user" | "agent"
  parts: A2APart[]
  metadata?: Record<string, unknown>
  taskId?: string
  contextId?: string
  messageId?: string
}

export interface A2AArtifact {
  artifactId: string
  name?: string
  parts: A2APart[]
}

export interface A2ATask {
  kind: "task"
  id: string
  contextId: string
  status: {
    state: TaskState
    message?: A2AMessage
  }
  artifacts?: A2AArtifact[]
}

export interface AgentCardSkill {
  id: string
  name: string
  description: string
  tags?: string[]
}

export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  protocolVersion: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    extensions?: { uri: string; description: string; required: boolean }[]
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentCardSkill[]
  supportsAuthenticatedExtendedCard: boolean
}

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
