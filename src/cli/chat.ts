/**
 * Interactive chat with an onchain agent.
 *
 * Usage:
 *   npm run chat                          # pick from existing agents
 *   npm run chat -- --agent my-agent      # open specific agent
 */

import * as fs from "node:fs";
import dotenv from "dotenv";
import * as p from "@clack/prompts";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { getLLM } from "../core/llm.js";
import { AGENTS_DIR, getOrCreateAgentWallet } from "../core/wallet.js";
import { discoverAgentSkills, resolveAgentSkills } from "../core/agent-skills.js";
import { createFileCheckpointer } from "../core/file-checkpoint.js";
import { loadAgentConfig, resolveToolsFromConfig } from "../core/agent-config.js";
import { findNetworkByChainId, setProcessNetwork } from "../core/config.js";
import { buildAgentSystemPrompt } from "../core/system-prompt.js";
import type { Skill } from "../actions/types.js";
import { runChatLoop } from "./chat-loop.js";
import { getFlag } from "./flags.js";

dotenv.config();

function listExistingAgents(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs
    .readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        (fs.existsSync(`${AGENTS_DIR}/${e.name}/wallet.json`) ||
          fs.existsSync(`${AGENTS_DIR}/${e.name}/agent-config.json`)),
    )
    .map((e) => e.name);
}

async function main() {
  let agentName = getFlag("agent");

  if (!agentName) {
    const agents = listExistingAgents();

    if (agents.length === 0) {
      console.error("No agents found. Create one first with: npm run create-agent");
      process.exit(1);
    }

    p.intro("Agent Chat");
    const selected = await p.select({
      message: "Select an agent",
      options: agents.map((name) => {
        const config = loadAgentConfig(name);
        const hint = config
          ? `actions: ${(config.metadata?.actions ?? []).join(", ") || "none"} | tools: ${(config.metadata?.tools ?? []).join(", ") || "none"}`
          : "legacy agent";
        return { value: name, label: name, hint };
      }),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    agentName = selected as string;
  }

  const wallet = getOrCreateAgentWallet({ agentName });
  process.env.AGENT_PRIVATE_KEY = wallet.privateKey;

  // Config-based loading (create-agent) or legacy skill discovery (deploy)
  const agentConfig = loadAgentConfig(agentName);
  let tools: Awaited<ReturnType<typeof resolveAgentSkills>>;
  let skills: Skill[] = [];
  let skillNames: string[];

  if (agentConfig) {
    const resolved = resolveToolsFromConfig(agentConfig);
    tools = resolved.tools;
    skills = resolved.skills;
    skillNames = skills.map((s) => s.name);
  } else {
    skillNames = discoverAgentSkills(agentName).map((c) => c.name);
    tools = await resolveAgentSkills(agentName, wallet.privateKey);
  }

  const { saver, flush } = createFileCheckpointer(agentName);

  console.log();
  console.log("=".repeat(60));
  console.log("  INTERACTIVE AGENT CHAT");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Agent        : ${agentName}`);
  console.log(`  Agent wallet : ${wallet.address}`);
  console.log(`  Tools        : ${tools.map((t) => t.name).join(", ") || "none"}`);
  console.log(`  Skills       : ${skillNames.length > 0 ? skillNames.join(", ") : "none"}`);
  console.log();
  console.log('  Type your message and press Enter. Type "exit" to quit.');
  console.log("=".repeat(60));
  console.log();

  // Tools read the active network: act on the agent's own chain, not NETWORK.
  const agentNetwork = agentConfig?.walletChainId
    ? findNetworkByChainId(agentConfig.walletChainId)
    : undefined;
  if (agentNetwork) setProcessNetwork(agentNetwork);

  const systemMessage = buildAgentSystemPrompt({
    agentName,
    walletAddress: wallet.address,
    agentConfig,
    skills,
  })
    .filter(Boolean)
    .join("\n");

  const llm = getLLM();
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: saver,
    prompt: systemMessage,
  });
  runChatLoop(agent, agentName, flush);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
