// SPDX-License-Identifier: Apache-2.0

// Types
export * from "./types.js";

// Level 2, standalone tools
export * from "./tools/index.js";

// Skills, exported separately for advanced use
export * from "./skills/index.js";

// Level 1, Actions (skill + tools bundled)
import { sendEthTool } from "./tools/send-eth.tool.js";
import { tokenBalanceTool } from "./tools/token-balance.tool.js";
import { giveFeedbackTool, getReputationTool } from "./tools/feedback.tool.js";
import {
  resolveEnsTool,
  lookupEnsTool,
  setPrimaryEnsTool,
  registerEnsTool,
} from "./tools/ens.tool.js";
import { fetchContractAbiTool } from "./tools/fetch-contract-abi.tool.js";
import { callContractTool } from "./tools/call-contract.tool.js";
import { transferEthSkill } from "./skills/transfer-eth.skill.js";
import { rateFeedbackSkill } from "./skills/rate-feedback.skill.js";
import { ensNameSkill } from "./skills/ens-name.skill.js";
import { contractCallSkill } from "./skills/contract-call.skill.js";
import type { Action } from "./types.js";

/**
 * @notice Action for transferring ETH on Arbitrum.
 * Bundles send_eth and get_token_balance tools with a skill
 * that guides the agent to check balances before sending.
 */
export const TransferEthAction = (): Action => ({
  name: "transfer-eth",
  description: "Transfer ETH on the agent's chain with balance checks and safety confirmations",
  tools: [sendEthTool, tokenBalanceTool],
  skill: transferEthSkill,
});

/**
 * @notice Action for ERC-8004 ratings + reputation reads.
 * Bundles give_feedback and get_reputation tools with the rate-feedback skill.
 */
export const RateFeedbackAction = (): Action => ({
  name: "rate-feedback",
  description: "Rate ERC-8004 agents after successful transactions and read reputation",
  tools: [giveFeedbackTool, getReputationTool],
  skill: rateFeedbackSkill,
});

/**
 * @notice Action for ENS resolve / lookup / registration / primary-name setup.
 * Bundles resolve_ens, lookup_ens, register_ens, and set_primary_ens with the ens-name skill.
 */
export const EnsNameAction = (): Action => ({
  name: "ens-name",
  description:
    "Resolve ENS names, look up primary names, register .eth names, and set the agent wallet primary ENS name",
  tools: [resolveEnsTool, lookupEnsTool, registerEnsTool, setPrimaryEnsTool],
  skill: ensNameSkill,
});

/**
 * @notice Action for discovering and calling verified contract functions.
 * Bundles fetch_contract_abi and call_contract with the contract-call skill.
 */
export const ContractCallAction = (): Action => ({
  name: "contract-call",
  description: "Discover a verified contract's functions and call them on the agent's chain",
  tools: [fetchContractAbiTool, callContractTool],
  skill: contractCallSkill,
});
