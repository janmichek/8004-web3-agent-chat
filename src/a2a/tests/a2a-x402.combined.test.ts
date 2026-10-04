/**
 * Combined A2A + x402 edge cases (standalone payment flow, mock facilitator).
 *
 * Run: npx vitest run src/a2a/tests/a2a-x402.combined.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { A2AServer, type A2AExecutor } from "../server.js"
import {
  MockFacilitatorClient,
  buildMockPaymentPayload,
  type MockFacilitatorOptions,
} from "../mock-facilitator.js"
import { X402_EXTENSION_URI, X402_EXTENSION_URI_LEGACY } from "../types.js"
import type { AgentConfig } from "../../core/agent-config.js"
import type { A2ATask, PaymentRequirements } from "../types.js"

const PAY_TO = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66"

function paidConfig(): AgentConfig {
  return {
    name: "paid-agent",
    description: "Paid A2A agent",
    walletAddress: PAY_TO,
    endpoints: [{ type: "A2A", value: "http://localhost:8787/api/a2a" }],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: true,
    metadata: { actions: [], tools: ["get_token_balance"] },
    createdAt: new Date().toISOString(),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

function meta(task: A2ATask): Record<string, unknown> {
  return (task.status.message?.metadata ?? {}) as Record<string, unknown>
}

function requirementsFrom(task: A2ATask): PaymentRequirements {
  const required = meta(task)["x402.payment.required"] as {
    accepts: PaymentRequirements[]
  }
  return required.accepts[0]!
}

describe("A2A + x402 combined flow (mock)", () => {
  let server: A2AServer

  function useFacilitator(options: MockFacilitatorOptions = {}, executor?: A2AExecutor): void {
    server = new A2AServer({
      endpointUrl: "http://localhost:8787/api/a2a",
      config: paidConfig(),
      facilitator: new MockFacilitatorClient(options),
      executor,
    })
  }

  beforeEach(() => useFacilitator())

  async function send(message: Record<string, unknown>): Promise<A2ATask> {
    const res = await server.handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { kind: "message", role: "user", ...message } },
      },
      X402_EXTENSION_URI,
    )
    return res.result as A2ATask
  }

  async function getTask(id: string): Promise<A2ATask> {
    const res = await server.handleJsonRpc({ jsonrpc: "2.0", id: 9, method: "tasks/get", params: { id } })
    return res.result as A2ATask
  }

  function requestService(text = "buy banana"): Promise<A2ATask> {
    return send({ parts: [{ kind: "text", text }] })
  }

  function submitPayment(
    taskId: string,
    payload: ReturnType<typeof buildMockPaymentPayload>,
  ): Promise<A2ATask> {
    return send({
      taskId,
      parts: [{ kind: "text", text: "here is payment" }],
      metadata: {
        "x402.payment.status": "payment-submitted",
        "x402.payment.payload": payload,
      },
    })
  }

  function rejectPayment(taskId: string): Promise<A2ATask> {
    return send({
      taskId,
      parts: [{ kind: "text", text: "no thanks" }],
      metadata: { "x402.payment.status": "payment-rejected" },
    })
  }

  it("happy path: required → submit → completed with receipt", async () => {
    const required = await requestService()
    expect(required.status.state).toBe("input-required")
    expect(meta(required)["x402.payment.status"]).toBe("payment-required")
    const reqs = requirementsFrom(required)
    expect(reqs.payTo).toBe(PAY_TO)
    expect(reqs.maxAmountRequired).toBe("10000")

    const payload = buildMockPaymentPayload({ requirements: reqs, from: PAYER })
    const done = await submitPayment(required.id, payload)
    expect(done.status.state).toBe("completed")
    expect(meta(done)["x402.payment.status"]).toBe("payment-completed")
    const receipts = meta(done)["x402.payment.receipts"] as { success: boolean; transaction: string }[]
    expect(receipts[0]?.success).toBe(true)
    expect(receipts[0]?.transaction).toMatch(/^0x/)
    expect(done.artifacts?.[0]?.parts[0]?.text).toContain("buy banana")
    expect(done.contextId).toBe(required.contextId)
    expect(reqs.resource).toBe("http://localhost:8787/api/a2a")
  })

  it("rejects monetized call without X-A2A-Extensions", async () => {
    const res = await server.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: "paywall" }],
        },
      },
    })
    const task = res.result as A2ATask
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("EXTENSION_NOT_ACTIVATED")
  })

  it("accepts legacy extension URI for activation", async () => {
    const res = await server.handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: { kind: "message", role: "user", parts: [{ kind: "text", text: "legacy" }] },
        },
      },
      X402_EXTENSION_URI_LEGACY,
    )
    expect((res.result as A2ATask).status.state).toBe("input-required")
  })

  it("client payment-rejected ends task as failed", async () => {
    const required = await requestService()
    const task = await rejectPayment(required.id)
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.status"]).toBe("payment-rejected")
    expect(meta(task)["x402.payment.error"]).toBe("PAYMENT_REJECTED")
  })

  it("unknown taskId on payment submission fails", async () => {
    const payload = buildMockPaymentPayload({
      requirements: requirementsFrom(await requestService()),
      from: PAYER,
    })
    const task = await submitPayment("task-does-not-exist", payload)
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("UNKNOWN_TASK")
  })

  it("missing payload fails with INVALID_PAYMENT", async () => {
    const required = await requestService()
    const task = await send({
      taskId: required.id,
      parts: [{ kind: "text", text: "oops" }],
      metadata: { "x402.payment.status": "payment-submitted" },
    })
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("INVALID_PAYMENT")
  })

  it("wrong amount → payment-failed WRONG_AMOUNT", async () => {
    const required = await requestService()
    const reqs = requirementsFrom(required)
    const payload = buildMockPaymentPayload({
      requirements: reqs,
      from: PAYER,
      value: "999",
    })
    const task = await submitPayment(required.id, payload)
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("WRONG_AMOUNT")
  })

  it("expired auth → EXPIRED_PAYMENT", async () => {
    useFacilitator({ now: () => 2_000_000_000 })
    const required = await requestService()
    const reqs = requirementsFrom(required)
    const payload = buildMockPaymentPayload({
      requirements: reqs,
      from: PAYER,
      validAfter: 1_000,
      validBefore: 2_000,
    })
    const task = await submitPayment(required.id, payload)
    expect(meta(task)["x402.payment.error"]).toBe("EXPIRED_PAYMENT")
  })

  it("insufficient funds → INSUFFICIENT_FUNDS", async () => {
    useFacilitator({ underfundedPayers: [PAYER] })
    const required = await requestService()
    const payload = buildMockPaymentPayload({
      requirements: requirementsFrom(required),
      from: PAYER,
    })
    const task = await submitPayment(required.id, payload)
    expect(meta(task)["x402.payment.error"]).toBe("INSUFFICIENT_FUNDS")
  })

  it("verify ok + settle fail → SETTLEMENT_FAILED", async () => {
    useFacilitator({ forceSettleFail: { reason: "facilitator down" } })
    const required = await requestService()
    const payload = buildMockPaymentPayload({
      requirements: requirementsFrom(required),
      from: PAYER,
    })
    const task = await submitPayment(required.id, payload)
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("SETTLEMENT_FAILED")
  })

  it("work runs after verify and before settle; a failed run is not charged", async () => {
    const calls: string[] = []
    const facilitator = new MockFacilitatorClient()
    const verify = facilitator.verify.bind(facilitator)
    const settle = facilitator.settle.bind(facilitator)
    facilitator.verify = async (...args) => (calls.push("verify"), verify(...args))
    facilitator.settle = async (...args) => (calls.push("settle"), settle(...args))
    let fail = false
    server = new A2AServer({
      endpointUrl: "http://localhost:8787/api/a2a",
      config: paidConfig(),
      facilitator,
      executor: {
        skills: [],
        run: async (text) => {
          calls.push("run")
          if (fail) throw new Error("LLM down")
          return `done: ${text}`
        },
      },
    })

    const ok = await requestService("job")
    const paid = await submitPayment(
      ok.id,
      buildMockPaymentPayload({ requirements: requirementsFrom(ok), from: PAYER }),
    )
    expect(paid.status.message?.parts[0]?.text).toBe("done: job")
    // settle() of the mock re-verifies internally, hence the second "verify".
    expect(calls).toEqual(["verify", "run", "settle", "verify"])

    calls.length = 0
    fail = true
    const second = await requestService("job 2")
    const unpaid = await submitPayment(
      second.id,
      buildMockPaymentPayload({ requirements: requirementsFrom(second), from: PAYER }),
    )
    expect(unpaid.status.state).toBe("failed")
    expect(meta(unpaid)["x402.payment.error"]).toBe("SERVER_ERROR")
    expect(calls).toEqual(["verify", "run"])
  })

  it("the executor does not run before payment", async () => {
    const run = vi.fn(async () => "x")
    useFacilitator({}, { skills: [], run })
    await requestService()
    expect(run).not.toHaveBeenCalled()
  })

  it("duplicate payment on same task → DUPLICATE_PAYMENT", async () => {
    const required = await requestService()
    const payload = buildMockPaymentPayload({
      requirements: requirementsFrom(required),
      from: PAYER,
    })
    const first = await submitPayment(required.id, payload)
    expect(first.status.state).toBe("completed")
    const second = await submitPayment(required.id, payload)
    expect(second.status.state).toBe("failed")
    expect(meta(second)["x402.payment.error"]).toBe("DUPLICATE_PAYMENT")
    // The paid task itself must stay completed.
    expect((await getTask(required.id)).status.state).toBe("completed")
  })

  it("payment-rejected after settlement does not undo the paid task", async () => {
    const required = await requestService()
    await submitPayment(
      required.id,
      buildMockPaymentPayload({ requirements: requirementsFrom(required), from: PAYER }),
    )
    const late = await rejectPayment(required.id)
    expect(meta(late)["x402.payment.error"]).toBe("DUPLICATE_PAYMENT")
    expect((await getTask(required.id)).status.state).toBe("completed")
  })

  it("payment on a failed task → TASK_NOT_AWAITING_PAYMENT", async () => {
    const required = await requestService()
    await rejectPayment(required.id)
    const task = await submitPayment(
      required.id,
      buildMockPaymentPayload({ requirements: requirementsFrom(required), from: PAYER }),
    )
    expect(meta(task)["x402.payment.error"]).toBe("TASK_NOT_AWAITING_PAYMENT")
    expect(meta(await getTask(required.id))["x402.payment.status"]).toBe("payment-rejected")
  })

  it("two concurrent unpaid tasks stay independent", async () => {
    const a = await requestService("skill-a")
    const b = await requestService("skill-b")
    expect(a.id).not.toBe(b.id)

    const payA = buildMockPaymentPayload({
      requirements: requirementsFrom(a),
      from: PAYER,
    })
    const doneA = await submitPayment(a.id, payA)
    expect(doneA.status.state).toBe("completed")

    // B still awaiting payment
    expect((await getTask(b.id)).status.state).toBe("input-required")

    const payB = buildMockPaymentPayload({
      requirements: requirementsFrom(b),
      from: PAYER,
    })
    const doneB = await submitPayment(b.id, payB)
    expect(doneB.status.state).toBe("completed")
    expect(doneB.status.message?.parts[0]?.text).toContain("skill-b")
  })

  it("wrong payTo + wrong network fails on the first mismatch (network)", async () => {
    const required = await requestService()
    const reqs = requirementsFrom(required)
    const payload = buildMockPaymentPayload({
      requirements: reqs,
      from: PAYER,
      to: "0x00000000000000000000000000000000000000ff",
      network: "polygon",
    })
    const task = await submitPayment(required.id, payload)
    expect(task.status.state).toBe("failed")
    expect(meta(task)["x402.payment.error"]).toBe("WRONG_NETWORK")
  })
})
