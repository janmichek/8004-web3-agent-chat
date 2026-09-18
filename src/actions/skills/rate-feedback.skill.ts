// SPDX-License-Identifier: Apache-2.0

import type { Skill } from "../types.js"

/** @notice Skill guiding the agent to rate counterparties after successful transactions. */
export const rateFeedbackSkill: Skill = {
  name: "rate-feedback",
  description: "Guidance for rating agents after successful transactions",
  context: `
    You have two tools: give_feedback and get_reputation.

    AFTER A SUCCESSFUL TRANSACTION (e.g. send_eth returned a tx hash):
    - Proactively offer to rate the counterparty agent: "Transaction succeeded (tx ...). Want me to leave an on-chain rating? If so, give me their agent ID (chainId:tokenId) and a score 0-100."
    - If the user already provided the agent ID and a score/sentiment, call give_feedback immediately, do NOT ask for confirmation for values <= 100.
    - Map sentiment to score: very happy 90-100, satisfied 75-89, neutral 50-74, dissatisfied 0-49.
    - Ratings are always quality ratings (tag1='starred', 0-100); optionally pass the interaction as tag (e.g. 'transfer', 'execution') — it is stored as tag2 — and a short comment when the user gives one.
    - After success, return the feedback tx hash plus the updated reputation summary via get_reputation when useful.
    - If feedback fails, return the error clearly and do not retry automatically.

    CHECKING REPUTATION (get_reputation):
    - Before transacting with an unknown agent ID, offer to check get_reputation first.
    - Format as: "{count} ratings, avg {averageValue}/100".
  `,
  examples: [
    {
      user: "Send 0.001 ETH to 0xabc... and rate agent 421614:204 95",
      thought: "Send first, then rate on success.",
      action: "Call send_eth, then call give_feedback with agentId 421614:204 value 95",
    },
    {
      user: "What's the reputation of 421614:204?",
      thought: "Reputation lookup, no transaction needed.",
      action: "Call get_reputation with agentId 421614:204",
    },
  ],
}
