// SPDX-License-Identifier: Apache-2.0

import type { Skill } from "../types.js"

/**
 * @notice Skill context for the contract-call action.
 * Guides the agent to discover a verified contract's ABI before calling it.
 */
export const contractCallSkill: Skill = {
  name: "contract-call",
  description: "Guidance for discovering and calling verified contract functions",
  context: `
    You have two tools: fetch_contract_abi and call_contract.
    Use the network from your system prompt (name and chain ID) for all responses.

    DISCOVERING FUNCTIONS (fetch_contract_abi):
    - Always call fetch_contract_abi with the contract address before calling an unfamiliar contract
    - The result is a numbered list of functions with their signatures and state mutability
    - Pick the exact function name from that list, never guess or invent one

    CALLING CONTRACTS (call_contract):
    - Pass the contract address, the exact function name, and args as a JSON array string
    - Argument order and count must match the ABI signature; omit args for functions with no inputs
    - Numeric integers may be passed as decimal strings; addresses must be 0x-prefixed and 42 characters
    - Use fetch_contract_abi first whenever you are unsure of the function name or parameter types

    READ CALLS (view/pure):
    - Execute immediately and return the decoded result
    - Format big integers clearly, including raw and human-readable values when useful

    WRITE CALLS (nonpayable/payable):
    - These spend gas and sign with the agent wallet; confirm with the user before the first write unless they explicitly asked to execute it now
    - After success, return the transaction hash and the block explorer link
    - If the call fails, return the revert reason clearly and do not retry automatically

    ERRORS:
    - If the ABI cannot be fetched, the contract is probably not verified; say so instead of guessing
    - If a function or argument is invalid, report the mismatch and offer the closest matching signature
  `,
  examples: [
    {
      user: "What functions does 0xabc... expose?",
      thought: "The user wants the contract surface, so only the ABI lookup is needed.",
      action: "Call fetch_contract_abi with address 0xabc..."
    },
    {
      user: "What's the total supply of 0xabc...?",
      thought: "Read call. Discover the exact function and confirm it is view/pure before calling.",
      action: "Call fetch_contract_abi, then call call_contract with functionName totalSupply"
    },
    {
      user: "Approve 100 USDC for 0xdef... on the token contract",
      thought: "State-changing call. Verify the function signature and amount argument order, then confirm.",
      action: "Call fetch_contract_abi, confirm the approval with the user, then call call_contract with args [\"0xdef...\", \"100\"]"
    }
  ]
}
