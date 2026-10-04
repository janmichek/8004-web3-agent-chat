/**
 * web3agent, deploy autonomous AI agents on Arbitrum.
 * @packageDocumentation
 */

export { getActiveNetwork, getNetworkConfig, getProvider, getRpcUrl, getChainId, getNetworkNameByChainId, getNetworkSlugByChainId } from "./core/config.js";
export { getLLM } from "./core/llm.js";
export type { LLMProvider } from "./core/llm.js";
export {
  AGENTS_DIR,
  getOrCreateAgentWallet,
  getAgentWalletEnvVars,
  getMasterWallet,
  getMasterWalletBalance,
  fundAgentWallet,
} from "./core/wallet.js";
export { runAgent } from "./core/orchestrator.js";
export { registerAgent } from "./core/registry.js";
export {
  discoverAgentSkills,
  listAgentSkills,
  resolveAgentSkills,
  buildSkillSystemPrompt,
} from "./core/agent-skills.js";
export type { SkillFactory } from "./core/agent-skills.js";
export { createFileCheckpointer } from "./core/file-checkpoint.js";
export {
  TransferEthAction,
  EnsNameAction,
  sendEthTool,
  tokenBalanceTool,
  transferEthSkill,
  tokenBalanceSkill,
  ensNameSkill,
  fetchContractAbiTool,
  callContractTool,
  resolveEnsTool,
  lookupEnsTool,
  setPrimaryEnsTool,
} from "./actions/index.js";
export type { Action, Skill } from "./actions/types.js";
export { ACTION_REGISTRY, TOOL_REGISTRY, getActionByName, getToolByName, getStandaloneToolInstance } from "./core/action-registry.js";
export type { ActionEntry, ToolEntry } from "./core/action-registry.js";
export { saveAgentConfig, loadAgentConfig, resolveToolsFromConfig, buildCapabilitySummary } from "./core/agent-config.js";
export type { AgentConfig, Endpoint, EndpointType } from "./core/agent-config.js";
export { A2AServer } from "./a2a/server.js";
export type { A2AExecutor, A2AServerOptions } from "./a2a/server.js";
export { HttpFacilitatorClient } from "./a2a/http-facilitator.js";
export { MockFacilitatorClient, buildMockPaymentPayload } from "./a2a/mock-facilitator.js";
export { X402_EXTENSION_URI } from "./a2a/types.js";
export type { AgentCard, FacilitatorClient, PaymentPayload, PaymentRequirements } from "./a2a/types.js";
export {
  buildRegistrationServices,
  canonicalizeServiceName,
  normalizeA2AEndpoint,
} from "./core/registration-services.js";

export type {
  NetworkName,
  NetworkConfig,
  WalletData,
  WalletOptions,
  FundAgentOptions,
  RegisterAgentOptions,
  RegistrationResult,
  RunAgentOptions,
  AgentRunResult,
  AgentSkillConfig,
  SwapInput,
  SwapResult,
} from "./core/types.js";
