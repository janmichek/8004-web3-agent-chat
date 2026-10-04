// SPDX-License-Identifier: Apache-2.0

/**
 * Mock x402 facilitator for offline tests and local A2A payment flows.
 * Never touches a chain — verify/settle are pure validation + fake tx hashes.
 *
 * @module a2a/mock-facilitator
 */

import { createHash, randomBytes } from "node:crypto"
import {
  X402_VERSION,
  type FacilitatorClient,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "./types.js"

export interface MockFacilitatorOptions {
  /** Force verify to fail with this reason/code. */
  forceVerifyFail?: { reason: string; errorCode?: VerifyResponse["errorCode"] }
  /** Force settle to fail after a successful verify. */
  forceSettleFail?: { reason: string; errorCode?: SettleResponse["errorCode"] }
  /** Wallet addresses treated as underfunded. */
  underfundedPayers?: string[]
  /** Clock override (unix seconds). Defaults to Date.now()/1000. */
  now?: () => number
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

function isHexSig(value: string): boolean {
  // Accept 65-byte ECDSA (130 hex) or longer mock sigs.
  return /^0x[a-fA-F0-9]{130,}$/.test(value)
}

function fakeTxHash(seed: string): string {
  return `0x${createHash("sha256").update(seed).digest("hex")}`
}

/**
 * Offline facilitator used by unit/e2e tests and local A2A servers.
 * Validates payload shape + requirement match; never broadcasts.
 */
export class MockFacilitatorClient implements FacilitatorClient {
  readonly name = "mock"
  private readonly underfunded: Set<string>
  private readonly now: () => number
  private readonly forceVerifyFail: MockFacilitatorOptions["forceVerifyFail"]
  private readonly forceSettleFail: MockFacilitatorOptions["forceSettleFail"]

  constructor(options: MockFacilitatorOptions = {}) {
    this.forceVerifyFail = options.forceVerifyFail
    this.forceSettleFail = options.forceSettleFail
    this.underfunded = new Set((options.underfundedPayers ?? []).map((a) => a.toLowerCase()))
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (this.forceVerifyFail) {
      return {
        isValid: false,
        invalidReason: this.forceVerifyFail.reason,
        errorCode: this.forceVerifyFail.errorCode ?? "INVALID_PAYMENT",
      }
    }

    if (!payload?.payload?.authorization || !payload.payload.signature) {
      return {
        isValid: false,
        invalidReason: "Missing authorization or signature",
        errorCode: "INVALID_PAYMENT",
      }
    }

    const auth = payload.payload.authorization
    if (!isAddress(auth.from) || !isAddress(auth.to)) {
      return {
        isValid: false,
        invalidReason: "Invalid from/to address",
        errorCode: "INVALID_PAYMENT",
      }
    }
    if (!isHexSig(payload.payload.signature)) {
      return {
        isValid: false,
        invalidReason: "Malformed signature",
        errorCode: "INVALID_SIGNATURE",
      }
    }

    if (payload.scheme !== requirements.scheme) {
      return {
        isValid: false,
        invalidReason: "Scheme mismatch",
        errorCode: "INVALID_PAYMENT",
      }
    }
    if (payload.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: `Network mismatch: got ${payload.network}, expected ${requirements.network}`,
        errorCode: "WRONG_NETWORK",
      }
    }
    if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: "payTo mismatch",
        errorCode: "WRONG_PAYEE",
      }
    }
    if (auth.value !== requirements.maxAmountRequired) {
      return {
        isValid: false,
        invalidReason: `Amount mismatch: got ${auth.value}, expected ${requirements.maxAmountRequired}`,
        errorCode: "WRONG_AMOUNT",
      }
    }
    if (payload.asset && payload.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: "Asset mismatch",
        errorCode: "WRONG_ASSET",
      }
    }

    const now = this.now()
    const validAfter = Number(auth.validAfter)
    const validBefore = Number(auth.validBefore)
    if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
      return {
        isValid: false,
        invalidReason: "Invalid validity window",
        errorCode: "INVALID_PAYMENT",
      }
    }
    if (now < validAfter) {
      return {
        isValid: false,
        invalidReason: "Authorization not yet valid",
        errorCode: "INVALID_PAYMENT",
      }
    }
    if (now > validBefore) {
      return {
        isValid: false,
        invalidReason: "Payment authorization was submitted after its validBefore timestamp",
        errorCode: "EXPIRED_PAYMENT",
      }
    }

    if (this.underfunded.has(auth.from.toLowerCase())) {
      return {
        isValid: false,
        payer: auth.from,
        invalidReason: "The client's wallet has insufficient funds to cover the payment",
        errorCode: "INSUFFICIENT_FUNDS",
      }
    }

    return { isValid: true, payer: auth.from }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verified = await this.verify(payload, requirements)
    if (!verified.isValid) {
      return {
        success: false,
        network: requirements.network,
        payer: verified.payer,
        errorReason: verified.invalidReason,
        errorCode: verified.errorCode ?? "INVALID_PAYMENT",
        transaction: "",
      }
    }

    if (this.forceSettleFail) {
      return {
        success: false,
        network: requirements.network,
        payer: verified.payer,
        errorReason: this.forceSettleFail.reason,
        errorCode: this.forceSettleFail.errorCode ?? "SETTLEMENT_FAILED",
        transaction: "",
      }
    }

    const seed =
      payload.payload.authorization.nonce ||
      `${payload.payload.signature}:${randomBytes(8).toString("hex")}`
    return {
      success: true,
      network: requirements.network,
      payer: verified.payer,
      transaction: fakeTxHash(seed),
    }
  }
}

/** Build a structurally valid mock PaymentPayload for tests. */
export function buildMockPaymentPayload(opts: {
  requirements: PaymentRequirements
  from: string
  /** Override signature (default: 65-byte mock hex). */
  signature?: string
  validAfter?: number
  validBefore?: number
  value?: string
  network?: string
  asset?: string
  to?: string
  nonce?: string
}): PaymentPayload {
  const now = Math.floor(Date.now() / 1000)
  const req = opts.requirements
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: opts.network ?? req.network,
    asset: opts.asset ?? req.asset,
    payload: {
      signature: opts.signature ?? `0x${"ab".repeat(65)}`,
      authorization: {
        from: opts.from,
        to: opts.to ?? req.payTo,
        value: opts.value ?? req.maxAmountRequired,
        validAfter: String(opts.validAfter ?? now - 60),
        validBefore: String(opts.validBefore ?? now + 600),
        nonce: opts.nonce ?? `0x${randomBytes(32).toString("hex")}`,
      },
    },
  }
}
