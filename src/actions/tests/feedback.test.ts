// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from "vitest"
import { normalizeRating } from "../../core/reputation.js"

describe("normalizeRating", () => {
  it("clamps to 0-100 and rounds", () => {
    expect(normalizeRating(95.4)).toBe(95)
    expect(normalizeRating(150)).toBe(100)
    expect(normalizeRating(-5)).toBe(0)
  })
  it("throws on NaN", () => {
    expect(() => normalizeRating(NaN)).toThrow()
  })
})

describe("feedback tools", () => {
  it("give_feedback errors without private key", async () => {
    vi.stubEnv("RATER_PRIVATE_KEY", "")
    vi.stubEnv("AGENT_PRIVATE_KEY", "")
    const { giveFeedbackTool } = await import("../tools/feedback.tool.js")
    const result = await giveFeedbackTool.invoke({ agentId: "421614:204", value: 90 })
    expect(result).toContain("Error")
  })
  it("RateFeedbackAction bundles tools + skill", async () => {
    const { RateFeedbackAction } = await import("../index.js")
    const action = RateFeedbackAction()
    expect(action.name).toBe("rate-feedback")
    expect(action.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["give_feedback", "get_reputation"])
    )
    expect(action.skill.name).toBe("rate-feedback")
  })
})
