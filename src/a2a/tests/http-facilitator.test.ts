/**
 * HttpFacilitatorClient against a stubbed fetch (request shape + response mapping).
 *
 * Run: npx vitest run src/a2a/tests/http-facilitator.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpFacilitatorClient } from "../http-facilitator.js"
import { buildMockPaymentPayload } from "../mock-facilitator.js"
import { buildPaymentRequirements } from "../x402.js"

const requirements = buildPaymentRequirements({
  payTo: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
  resource: "https://example.com/api/a2a",
})
const payload = buildMockPaymentPayload({
  requirements,
  from: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
})

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("HttpFacilitatorClient", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("posts the x402 v1 envelope to /verify and /settle", async () => {
    const fetchMock = stubFetch(200, { isValid: true, payer: "0xpayer" })
    const client = new HttpFacilitatorClient("https://fac.example/facilitator/")
    expect(await client.verify(payload, requirements)).toEqual({ isValid: true, payer: "0xpayer" })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://fac.example/facilitator/verify")
    expect(JSON.parse(init.body as string)).toEqual({
      x402Version: 1,
      paymentPayload: payload,
      paymentRequirements: requirements,
    })
    expect(client.name).toBe("https://fac.example/facilitator")
  })

  it("maps facilitator reasons to error codes", async () => {
    const client = new HttpFacilitatorClient("https://fac.example")
    stubFetch(200, { isValid: false, invalidReason: "invalid_exact_evm_signature" })
    expect((await client.verify(payload, requirements)).errorCode).toBe("INVALID_SIGNATURE")
    stubFetch(200, { isValid: false, invalidReason: "insufficient_funds" })
    expect((await client.verify(payload, requirements)).errorCode).toBe("INSUFFICIENT_FUNDS")
    stubFetch(200, { isValid: false, invalidReason: "something_new" })
    expect((await client.verify(payload, requirements)).errorCode).toBe("INVALID_PAYMENT")
  })

  it("treats HTTP and network failures as failed, never as paid", async () => {
    const client = new HttpFacilitatorClient("https://fac.example")
    stubFetch(500, {})
    expect(await client.verify(payload, requirements)).toMatchObject({
      isValid: false,
      errorCode: "SERVER_ERROR",
    })
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    expect(await client.settle(payload, requirements)).toMatchObject({
      success: false,
      errorCode: "SETTLEMENT_FAILED",
      errorReason: "offline",
    })
  })

  it("returns the settlement transaction", async () => {
    stubFetch(200, { success: true, transaction: "0xabc", payer: "0xpayer" })
    const client = new HttpFacilitatorClient("https://fac.example")
    expect(await client.settle(payload, requirements)).toEqual({
      success: true,
      network: "base-sepolia",
      payer: "0xpayer",
      transaction: "0xabc",
    })
  })
})
