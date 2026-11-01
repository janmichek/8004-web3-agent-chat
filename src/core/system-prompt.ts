import type { Skill } from "../actions/types.js";
import { buildCapabilitySummary, type AgentConfig } from "./agent-config.js";
import { getNetworkConfig, getNetworkNameByChainId } from "./config.js";

/**
 * Persona + capability preamble shared by the CLI chat and the HTTP/A2A agent.
 * Callers append their own rules before joining and filtering empty lines.
 */
export function buildAgentSystemPrompt(params: {
  agentName: string;
  walletAddress: string;
  agentConfig: AgentConfig | null;
  skills: Skill[];
}): string[] {
  const { agentName, walletAddress, agentConfig, skills } = params;
  const networkName = agentConfig?.walletChainId
    ? getNetworkNameByChainId(agentConfig.walletChainId)
    : getNetworkConfig().name;

  const skillContext = skills.map((s) => `## Skill: ${s.name}\n\n${s.context}`).join("\n\n");
  const capabilitySummary = agentConfig
    ? buildCapabilitySummary(agentConfig)
    : "No capabilities configured.";

  return [
    `You are "${agentName}", an onchain AI agent on ${networkName}.`,
    `Your wallet address is: ${walletAddress}`,
    agentConfig?.walletChainId ? `Chain ID: ${agentConfig.walletChainId}` : "",
    agentConfig?.agentId ? `ERC-8004 Agent ID: ${agentConfig.agentId}` : "",
    "",
    `## Your Capabilities\n\n${capabilitySummary}`,
    skillContext,
  ];
}
