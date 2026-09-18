// SPDX-License-Identifier: Apache-2.0
/**
 * E2E: transfer a dust amount on testnet, then leave an on-chain rating.
 *
 * Uses the agent's small testnet balance. Requires:
 *   RUN_E2E=1 AGENT_PRIVATE_KEY=0x... RPC_URL=... NETWORK=arbitrum-sepolia
 *   E2E_RECIPIENT=0x...  (dust receiver, can be own address)
 *   E2E_RATE_AGENT_ID=421614:204 (agent to rate)
 *
 * Run: RUN_E2E=1 npx vitest run src/actions/tests/reputation.e2e.test.ts
 */
import { describe, it, expect } from "vitest"

const RUN_E2E = process.env.RUN_E2E === "1";

describe.runIf(RUN_E2E)("reputation e2e (testnet, spends dust)", () => {
  it("sends dust then gives feedback and reads reputation", async () => {
    const { sendEthTool } = await import("../tools/send-eth.tool.js")
    const { giveFeedbackTool, getReputationTool } = await import("../tools/feedback.tool.js")

    const to = process.env.E2E_RECIPIENT
    const agentId = process.env.E2E_RATE_AGENT_ID
    expect(to, "set E2E_RECIPIENT").toBeTruthy()
    expect(agentId, "set E2E_RATE_AGENT_ID").toBeTruthy()

    // 1. Small-balance transfer (dust)
    const txHash = await sendEthTool.invoke({ to: to!, amount: "0.00001" })
    expect(txHash).not.toContain("Error")

    // 2. Rate after successful transaction (always quality/starred)
    const feedbackTx = await giveFeedbackTool.invoke({
      agentId: agentId!,
      value: 90,
      tag: "starred",
      comment: "e2e test: dust transfer succeeded",
    })
    expect(feedbackTx).not.toContain("Error")

    // 3. Reputation summary reflects feedback
    const summaryRaw = await getReputationTool.invoke({ agentId: agentId! })
    expect(summaryRaw).not.toContain("Error")
    const summary = JSON.parse(summaryRaw as string)
    expect(summary.count).toBeGreaterThanOrEqual(1)
    expect(summary.averageValue).toBeGreaterThan(0)
  }, 180_000)
})
