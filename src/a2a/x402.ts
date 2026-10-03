// SPDX-License-Identifier: Apache-2.0

/**
 * x402 payment helpers for the A2A standalone flow (requirements + metadata).
 *
 * @module a2a/x402
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentStatus,
  SettlementReceipt,
  X402PaymentRequiredResponse,
} from "./types.js"
import { X402_EXTENSION_URI, X402_EXTENSION_URI_LEGACY } from "./types.js"

/** Default mock USDC on Base Sepolia (for requirement shape only — never settled). */
export const MOCK_USDC_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
export const MOCK_PAYMENT_NETWORK = "base-sepolia"
export const DEFAULT_PRICE_ATOMIC = "10000" // 0.01 USDC (6 decimals)

export interface BuildRequirementsOptions {
  payTo: string
  resource: string
  description?: string
  amount?: string
  network?: string
  asset?: string
  maxTimeoutSeconds?: number
}

export function buildPaymentRequirements(
  options: BuildRequirementsOptions,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: options.network ?? MOCK_PAYMENT_NETWORK,
    maxAmountRequired: options.amount ?? DEFAULT_PRICE_ATOMIC,
    asset: options.asset ?? MOCK_USDC_ASSET,
    payTo: options.payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 600,
    description: options.description ?? "Payment required for A2A skill",
    resource: options.resource,
    mimeType: "application/json",
    extra: { name: "USD Coin", version: "2" },
  }
}

export function buildPaymentRequiredResponse(
  accepts: PaymentRequirements[],
  error = "Payment required to access this resource",
): X402PaymentRequiredResponse {
  return {
    x402Version: 1,
    error,
    accepts,
  }
}

/** True if the client activated a known x402 extension URI. */
export function isX402ExtensionActivated(headerValue: string | undefined): boolean {
  if (!headerValue?.trim()) return false
  const parts = headerValue.split(",").map((p) => p.trim())
  return parts.some(
    (p) => p === X402_EXTENSION_URI || p === X402_EXTENSION_URI_LEGACY,
  )
}

export function paymentStatusFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PaymentStatus | undefined {
  const status = metadata?.["x402.payment.status"]
  if (typeof status !== "string") return undefined
  return status as PaymentStatus
}

export function paymentPayloadFromMetadata(
  metadata: Record<string, unknown> | undefined,
): PaymentPayload | undefined {
  const raw = metadata?.["x402.payment.payload"]
  if (!raw || typeof raw !== "object") return undefined
  return raw as PaymentPayload
}

export function buildAgentPaymentMetadata(opts: {
  status: PaymentStatus
  required?: X402PaymentRequiredResponse
  receipts?: SettlementReceipt[]
  error?: string
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    "x402.payment.status": opts.status,
  }
  if (opts.required) meta["x402.payment.required"] = opts.required
  if (opts.receipts) meta["x402.payment.receipts"] = opts.receipts
  if (opts.error) meta["x402.payment.error"] = opts.error
  return meta
}
