// SPDX-License-Identifier: Apache-2.0

/**
 * x402 payment helpers for the A2A standalone flow (requirements + metadata).
 *
 * @module a2a/x402
 */

import {
  X402_EXTENSION_URI,
  X402_EXTENSION_URI_LEGACY,
  type PaymentErrorCode,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentStatus,
  type SettlementReceipt,
  type X402PaymentRequiredResponse,
} from "./types.js"

/** USDC on Base Sepolia (for requirement shape only — the mock never settles). */
export const MOCK_USDC_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
export const MOCK_PAYMENT_NETWORK = "base-sepolia"
export const DEFAULT_PRICE_ATOMIC = "10000" // 0.01 USDC (6 decimals)

export function buildPaymentRequirements(options: {
  payTo: string
  resource: string
  description?: string
  amount?: string
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: MOCK_PAYMENT_NETWORK,
    maxAmountRequired: options.amount ?? DEFAULT_PRICE_ATOMIC,
    asset: MOCK_USDC_ASSET,
    payTo: options.payTo,
    maxTimeoutSeconds: 600,
    description: options.description ?? "Payment required for A2A skill",
    resource: options.resource,
    mimeType: "application/json",
    // EIP-712 domain of the Base Sepolia USDC contract (EIP-3009 signing).
    extra: { name: "USDC", version: "2" },
  }
}

/** True if the client activated a known x402 extension URI. */
export function isX402ExtensionActivated(headerValue: string | undefined): boolean {
  if (!headerValue) return false
  return headerValue
    .split(",")
    .map((p) => p.trim())
    .some((p) => p === X402_EXTENSION_URI || p === X402_EXTENSION_URI_LEGACY)
}

export function paymentStatusFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PaymentStatus | undefined {
  const status = metadata?.["x402.payment.status"]
  return typeof status === "string" ? (status as PaymentStatus) : undefined
}

export function paymentPayloadFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PaymentPayload | undefined {
  const raw = metadata?.["x402.payment.payload"]
  return raw && typeof raw === "object" ? (raw as PaymentPayload) : undefined
}

export function buildAgentPaymentMetadata(opts: {
  status: PaymentStatus
  required?: X402PaymentRequiredResponse
  receipts?: SettlementReceipt[]
  error?: PaymentErrorCode
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    "x402.payment.status": opts.status,
  }
  if (opts.required) meta["x402.payment.required"] = opts.required
  if (opts.receipts) meta["x402.payment.receipts"] = opts.receipts
  if (opts.error) meta["x402.payment.error"] = opts.error
  return meta
}
