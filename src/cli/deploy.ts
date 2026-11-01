/**
 * Deploy an agent: create wallet, fund it, install skills, open chat.
 *
 * Usage:
 *   npm run deploy -- --name my-agent
 *   npm run deploy -- --name my-agent --skip-register
 *   npm run deploy -- --name my-agent --fund 0.005
 */

import dotenv from "dotenv";
import * as p from "@clack/prompts";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { getLLM } from "../core/llm.js";
import { getProvider } from "../core/config.js";
import { discoverAgentSkills, resolveAgentSkills } from "../core/agent-skills.js";
import { createFileCheckpointer } from "../core/file-checkpoint.js";
import { runChatLoop } from "./chat-loop.js";
import { hasFlag } from "./flags.js";
import {
  askAgentName,
  askFundAmount,
  createAgentWallet,
  fundAgent,
  offerChat,
  printEnvironment,
  registerWithSpinner,
} from "./prompts.js";

dotenv.config();

const skipRegister = hasFlag("skip-register");

// ---------------------------------------------------------------------------
// Interactive chat (post-deploy)
// ---------------------------------------------------------------------------
async function startChat(
  agentName: string,
  privateKey: string,
  masterAddress: string,
): Promise<void> {
  const skillNames = discoverAgentSkills(agentName).map((c) => c.name);
  const tools = await resolveAgentSkills(agentName, privateKey);
  const { saver, flush } = createFileCheckpointer(agentName);

  console.log();
  console.log(`  Agent  : ${agentName}`);
  console.log(`  Skills : ${skillNames.join(", ") || "none"}`);
  console.log(`  Master : ${masterAddress}`);
  console.log();
  console.log('  Type your message and press Enter. Type "exit" to quit.');
  console.log();

  const llm = getLLM();
  const agent = createReactAgent({ llm, tools, checkpointSaver: saver });
  runChatLoop(agent, agentName, flush);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  p.intro("Deploy Agent");

  const { masterWallet } = await printEnvironment();
  const agentName = await askAgentName();

  // --- Create wallet ---
  const s = p.spinner();
  const agentWallet = createAgentWallet(agentName, s);

  await fundAgent(agentWallet.address, await askFundAmount(), s);

  // --- Registration ---
  if (!skipRegister) {
    await registerWithSpinner(s, {
      name: agentName,
      description: `Agent ${agentName}`,
      privateKey: masterWallet.privateKey,
      walletAddress: agentWallet.address,
      agentWalletPrivateKey: agentWallet.privateKey,
      metadata: {
        skills: discoverAgentSkills(agentName).map((c) => c.name),
      },
    });
  } else {
    p.log.info("Skipping ERC-8004 registration (--skip-register)");
  }

  // --- Summary ---
  const provider = getProvider();
  const agentBalance = await provider.getBalance(agentWallet.address);
  const { ethers } = await import("ethers");

  const discoveredSkills = discoverAgentSkills(agentName).map((c) => c.name);

  p.note(
    `Name    : ${agentName}\n` +
      `Wallet  : ${agentWallet.address}\n` +
      `Balance : ${ethers.formatEther(agentBalance)} ETH\n` +
      `Skills  : ${discoveredSkills.join(", ") || "none"}\n` +
      `Master  : ${masterWallet.address}`,
    "Agent Deployed",
  );

  // --- Open chat ---
  await offerChat(agentName, () =>
    startChat(agentName, agentWallet.privateKey, masterWallet.address),
  );
}

main().catch((err) => {
  p.cancel(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
