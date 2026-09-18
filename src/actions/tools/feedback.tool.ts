// SPDX-License-Identifier: Apache-2.0

import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { giveFeedback, getReputationSummary } from "../../core/reputation.js"

function raterPrivateKey(): string | undefined {
  return process.env.RATER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY
}

/**
 * @notice Submit an ERC-8004 quality rating (0-100, tag1='starred') for an agent,
 * typically called after a successful transaction with that agent/counterparty.
 * Prefer RATER_PRIVATE_KEY so the signer is not the agent owner/operator.
 * Never throws; returns tx hash on success or error string on failure.
 */
export const giveFeedbackTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "give_feedback",
  description:
    "Rate an ERC-8004 agent after a successful transaction as a quality rating. " +
    "value is 0-100 (e.g. 90 = satisfied, stars = value/20). Always stored with tag1='starred' " +
    "so it shows as QUALITY RATING on 8004scan. Returns the feedback tx hash on success.",
  schema: z.object({
    agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
    value: z.number().describe("Rating 0-100"),
    tag: z.string().optional().describe("Optional interaction context stored as tag2, e.g. 'transfer'"),
    endpoint: z.string().optional().describe("Optional endpoint the rating applies to"),
    comment: z.string().optional().describe("Optional short review comment"),
  }),
  func: async ({ agentId, value, tag, endpoint, comment }): Promise<string> => {
    try {
      const privateKey = raterPrivateKey()
      if (!privateKey) {
        return "Error: RATER_PRIVATE_KEY (or AGENT_PRIVATE_KEY) environment variable is not set"
      }
      const result = await giveFeedback({ agentId, value, tag, endpoint, comment, privateKey })
      return result.feedbackURI ? `${result.txHash} (feedback: ${result.feedbackURI})` : result.txHash
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const short = message.length > 300 ? message.slice(0, 300) + "..." : message
      return `Error: ${short}`
    }
  },
})

/** @notice Read an agent's reputation summary (count + average score). */
export const getReputationTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "get_reputation",
  description:
    "Get an ERC-8004 agent's reputation summary (feedback count and average 0-100 score).",
  schema: z.object({
    agentId: z.string().describe("ERC-8004 agent ID, e.g. '421614:204'"),
    tag: z.string().optional().describe("Optional tag filter"),
  }),
  func: async ({ agentId, tag }): Promise<string> => {
    try {
      const summary = await getReputationSummary(agentId, tag)
      return JSON.stringify(summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `Error: ${message.slice(0, 300)}`
    }
  },
})
