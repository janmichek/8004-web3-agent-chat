/**
 * Separate x402 helper edge cases (extension activation + requirement builders).
 *
 * Run: npx vitest run src/a2a/tests/x402-helpers.test.ts
 */
import { describe, it, expect } from "vitest"
import {
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  isX402ExtensionActivated,
  paymentPayloadFromMetadata,
  paymentStatusFromMetadata,
  MOCK_PAYMENT_NETWORK,
  MOCK_USDC_ASSET,
} from "../x402.js"
import { X402_EXTENSION_URI, X402_EXTENSION_URI_LEGACY } from "../types.js"

describe("x402 helpers", () => {
  it("builds default requirements", () => {
    const req = buildPaymentRequirements({
      payTo: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      resource: "https://host/api/a2a",
    })
    expect(req.scheme).toBe("exact")
    expect(req.network).toBe(MOCK_PAYMENT_NETWORK)
    expect(req.asset).toBe(MOCK_USDC_ASSET)
    expect(req.maxAmountRequired).toBe("10000")
  })

  it("buildPaymentRequiredResponse wraps accepts", () => {
    const req = buildPaymentRequirements({
      payTo: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      resource: "https://host/api/a2a",
    })
    const resp = buildPaymentRequiredResponse([req])
    expect(resp.x402Version).toBe(1)
    expect(resp.accepts).toHaveLength(1)
  })

  it("isX402ExtensionActivated handles csv + legacy + empty", () => {
    expect(isX402ExtensionActivated(undefined)).toBe(false)
    expect(isX402ExtensionActivated("")).toBe(false)
    expect(isX402ExtensionActivated(X402_EXTENSION_URI)).toBe(true)
    expect(isX402ExtensionActivated(X402_EXTENSION_URI_LEGACY)).toBe(true)
    expect(
      isX402ExtensionActivated(`other, ${X402_EXTENSION_URI}, more`),
    ).toBe(true)
    expect(isX402ExtensionActivated("https://example.com/not-x402")).toBe(false)
  })

  it("reads payment status/payload from metadata", () => {
    expect(paymentStatusFromMetadata(undefined)).toBeUndefined()
    expect(
      paymentStatusFromMetadata({ "x402.payment.status": "payment-submitted" }),
    ).toBe("payment-submitted")
    expect(paymentPayloadFromMetadata({})).toBeUndefined()
    expect(
      paymentPayloadFromMetadata({
        "x402.payment.payload": { x402Version: 1, scheme: "exact", network: "base-sepolia", payload: {} },
      }),
    ).toBeTruthy()
  })
})
