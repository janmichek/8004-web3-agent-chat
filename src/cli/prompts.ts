import * as p from "@clack/prompts";
import { getActiveNetwork, getNetworkConfig, getProvider } from "../core/config.js";
import {
  fundAgentWallet,
  getMasterWallet,
  getMasterWalletBalance,
  getOrCreateAgentWallet,
} from "../core/wallet.js";
import { registerAgent } from "../core/registry.js";
import { getFlag } from "./flags.js";

/** Prints the network/master summary and returns the wallet later steps need. */
export async function printEnvironment(): Promise<{
  network: string;
  masterWallet: ReturnType<typeof getMasterWallet>;
}> {
  const network = getActiveNetwork();
  const networkConfig = getNetworkConfig();
  const masterWallet = getMasterWallet();
  const masterBalance = await getMasterWalletBalance();

  p.note(
    `Network : ${networkConfig.name} (${network})\n` +
      `Master  : ${masterWallet.address}\n` +
      `Balance : ${masterBalance} ETH`,
    "Environment",
  );

  return { network, masterWallet };
}

/** `--name` flag, else an interactive prompt. */
export async function askAgentName(): Promise<string> {
  const fromFlag = getFlag("name");
  if (fromFlag) return fromFlag;

  const result = await p.text({
    message: "Agent name",
    placeholder: "my-agent",
    validate: (v) => (!v?.trim() ? "Name is required" : undefined),
  });
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result;
}

/** `--fund` flag, else an interactive prompt with a 0.002 ETH default. */
export async function askFundAmount(): Promise<string> {
  const fromFlag = getFlag("fund");
  if (fromFlag) return fromFlag;

  const result = await p.text({
    message: "ETH to fund agent",
    placeholder: "0.002",
    initialValue: "0.002",
  });
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result || "0.002";
}

/** Creates (or reuses) the agent wallet, reporting progress on the given spinner. */
export function createAgentWallet(
  agentName: string,
  s: ReturnType<typeof p.spinner>,
): ReturnType<typeof getOrCreateAgentWallet> {
  s.start(`Creating agent "${agentName}"...`);
  const wallet = getOrCreateAgentWallet({ agentName });
  s.stop(`Agent wallet: ${wallet.address}`);
  return wallet;
}

/** Funds the agent wallet, reporting progress on the given spinner. */
export async function fundAgent(
  agentAddress: string,
  amountEth: string,
  s: ReturnType<typeof p.spinner>,
): Promise<void> {
  s.start(`Funding agent with ${amountEth} ETH...`);
  try {
    const txHash = await fundAgentWallet({ agentAddress, amountEth });
    const provider = getProvider();
    const receipt = await provider.waitForTransaction(txHash);
    s.stop(`Funded (block ${receipt?.blockNumber}): ${txHash}`);
  } catch (err) {
    s.stop(`Funding failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Registers on ERC-8004 with a spinner; `null` when registration failed. */
export async function registerWithSpinner(
  s: ReturnType<typeof p.spinner>,
  params: Parameters<typeof registerAgent>[0],
): Promise<Awaited<ReturnType<typeof registerAgent>> | null> {
  s.start("Registering on ERC-8004...");
  try {
    const reg = await registerAgent(params);
    s.stop(`Registered. Agent ID: ${reg.agentId} (${reg.agentURI})`);
    return reg;
  } catch (err) {
    s.stop(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Asks whether to open the REPL; runs `start` only when the user agrees. */
export async function offerChat(agentName: string, start: () => Promise<void>): Promise<void> {
  const result = await p.confirm({
    message: "Open interactive chat?",
    initialValue: true,
  });
  if (p.isCancel(result) || !result) {
    p.outro("Done. Run `npm run chat -- --agent " + agentName + "` to chat later.");
    return;
  }
  p.outro("Starting chat...");
  await start();
}
