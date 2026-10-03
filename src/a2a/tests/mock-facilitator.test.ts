/**
 * Separate x402 mock-facilitator edge cases (no A2A transport).
 *
 * Run: npx vitest run src/a2a/tests/mock-facilitator.test.ts
 */
import { describe, it, expect } from "vitest"
import {
  MockFacilitatorClient,
  buildMockPaymentPayload,
} from "../mock-facilitator.js"
import { buildPaymentRequirements } from "../x402.js"

const PAY_TO = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66"

function req() {
  return buildPaymentRequirements({
    payTo: PAY_TO,
    resource: "https://example.com/api/a2a",
    amount: "10000",
  })
}

describe("MockFacilitatorClient (x402 only)", () => {
  it("verifies and settles a well-formed payload", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({ requirements, from: PAYER })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(true)
    expect(verified.payer).toBe(PAYER)
    const settled = await fac.settle(payload, requirements)
    expect(settled.success).toBe(true)
    expect(settled.transaction).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it("rejects missing authorization/signature", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const bad = buildMockPaymentPayload({ requirements, from: PAYER })
    // @ts-expect-error intentional
    bad.payload.authorization = undefined
    const verified = await fac.verify(bad, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("INVALID_PAYMENT")
  })

  it("rejects malformed signature", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      signature: "0xdead",
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("INVALID_SIGNATURE")
  })

  it("rejects wrong amount", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      value: "1",
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("WRONG_AMOUNT")
  })

  it("rejects wrong payee", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      to: "0x0000000000000000000000000000000000000001",
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("WRONG_PAYEE")
  })

  it("rejects wrong network", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      network: "ethereum",
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("WRONG_NETWORK")
  })

  it("rejects wrong asset", async () => {
    const fac = new MockFacilitatorClient()
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      asset: "0x00000000000000000000000000000000000000aa",
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("WRONG_ASSET")
  })

  it("rejects expired authorization", async () => {
    const now = 1_700_000_000
    const fac = new MockFacilitatorClient({ now: () => now })
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      validAfter: now - 1000,
      validBefore: now - 1,
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("EXPIRED_PAYMENT")
  })

  it("rejects not-yet-valid authorization", async () => {
    const now = 1_700_000_000
    const fac = new MockFacilitatorClient({ now: () => now })
    const requirements = req()
    const payload = buildMockPaymentPayload({
      requirements,
      from: PAYER,
      validAfter: now + 100,
      validBefore: now + 1000,
    })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("INVALID_PAYMENT")
  })

  it("rejects underfunded payer", async () => {
    const fac = new MockFacilitatorClient({
      underfundedPayers: new Set([PAYER]),
    })
    const requirements = req()
    const payload = buildMockPaymentPayload({ requirements, from: PAYER })
    const verified = await fac.verify(payload, requirements)
    expect(verified.isValid).toBe(false)
    expect(verified.errorCode).toBe("INSUFFICIENT_FUNDS")
  })

  it("forceVerifyFail / forceSettleFail overrides", async () => {
    const fac = new MockFacilitatorClient({
      forceVerifyFail: { reason: "boom", errorCode: "SERVER_ERROR" },
    })
    const requirements = req()
    const payload = buildMockPaymentPayload({ requirements, from: PAYER })
    expect((await fac.verify(payload, requirements)).errorCode).toBe("SERVER_ERROR")

    const fac2 = new MockFacilitatorClient({
      forceSettleFail: { reason: "settle boom", errorCode: "SETTLEMENT_FAILED" },
    })
    const settled = await fac2.settle(payload, requirements)
    expect(settled.success).toBe(false)
    expect(settled.errorCode).toBe("SETTLEMENT_FAILED")
  })
})
