// SPDX-License-Identifier: Apache-2.0

/**
 * x402 facilitator over HTTP (`POST {url}/verify`, `POST {url}/settle`),
 * e.g. https://x402.org/facilitator for Base Sepolia. Unlike the mock, this
 * recovers the EIP-3009 signature and broadcasts the transfer on settle.
 *
 * @module a2a/http-facilitator
 */

import {
  X402_VERSION,
  type FacilitatorClient,
  type PaymentErrorCode,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "./types.js"

const TIMEOUT_MS = 20_000

/** Facilitator reasons are snake_case strings; map the common ones. */
function errorCodeFor(reason: string | undefined): PaymentErrorCode {
  const r = reason ?? ""
  if (/insufficient_funds/.test(r)) return "INSUFFICIENT_FUNDS"
  if (/signature/.test(r)) return "INVALID_SIGNATURE"
  if (/valid_before|expired/.test(r)) return "EXPIRED_PAYMENT"
  if (/recipient|pay_to/.test(r)) return "WRONG_PAYEE"
  if (/network/.test(r)) return "WRONG_NETWORK"
  if (/value|amount/.test(r)) return "WRONG_AMOUNT"
  return "INVALID_PAYMENT"
}

export class HttpFacilitatorClient implements FacilitatorClient {
  readonly name: string
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.name = this.baseUrl
  }

  private async post(
    path: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: X402_VERSION,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`facilitator ${path} returned HTTP ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    try {
      const body = await this.post("/verify", payload, requirements)
      const payer = typeof body.payer === "string" ? body.payer : undefined
      if (body.isValid === true) return { isValid: true, payer }
      const invalidReason = typeof body.invalidReason === "string" ? body.invalidReason : undefined
      return { isValid: false, payer, invalidReason, errorCode: errorCodeFor(invalidReason) }
    } catch (err) {
      return {
        isValid: false,
        invalidReason: err instanceof Error ? err.message : String(err),
        errorCode: "SERVER_ERROR",
      }
    }
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    try {
      const body = await this.post("/settle", payload, requirements)
      const payer = typeof body.payer === "string" ? body.payer : undefined
      const transaction = typeof body.transaction === "string" ? body.transaction : ""
      if (body.success === true) {
        return { success: true, network: requirements.network, payer, transaction }
      }
      return {
        success: false,
        network: requirements.network,
        payer,
        transaction,
        errorReason: typeof body.errorReason === "string" ? body.errorReason : "Settlement failed",
        errorCode: "SETTLEMENT_FAILED",
      }
    } catch (err) {
      return {
        success: false,
        network: requirements.network,
        errorReason: err instanceof Error ? err.message : String(err),
        errorCode: "SETTLEMENT_FAILED",
      }
    }
  }
}
