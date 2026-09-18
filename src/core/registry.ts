/**
 * ERC-8004 Identity Registry integration.
 *
 * Uses the @blockbyvlog/agent0-sdk package to register agents on the
 * ERC-8004 Identity Registry. This gives each agent a verifiable onchain
 * identity that other agents and protocols can reference.
 *
 * NOTE: The @blockbyvlog/agent0-sdk is in alpha. Registration is best-effort.
 * Always wrap calls in try/catch and handle failures gracefully.
 *
 * @module registry
 */

import { SDK } from "@blockbyvlog/agent0-sdk";
import type { RegisterAgentOptions, RegistrationResult } from "./types.js";
import { getActiveNetwork, getNetworkConfig, getRpcUrl } from "./config.js";

/**
 * Registers an agent on the ERC-8004 Identity Registry.
 *
 * Uses Pinata IPFS mode whenever PINATA_JWT (or IPFS_NODE_URL) is set, so the
 * on-chain tokenURI is `ipfs://<cid>` with resolvable name/description
 * metadata visible on 8004scan. Falls back to HTTP mode only when no IPFS
 * backend is configured.
 *
 * NOTE: The @blockbyvlog/agent0-sdk is in alpha. Registration is best-effort
 * and may fail on certain networks or under load. Callers should always wrap
 * this function in try/catch.
 *
 * @param options - Registration options.
 * @returns The registration result with agent ID, transaction hash and agentURI.
 * @throws If registration fails (SDK error, network error, etc.).
 *
 * @example
 * ```ts
 * try {
 *   const result = await registerAgent({
 *     name: "my-swap-agent",
 *     description: "Executes Uniswap swaps on Arbitrum Sepolia",
 *     privateKey: wallet.privateKey,
 *     walletAddress: wallet.address,
 *   });
 *   console.log(`Registered as agent #${result.agentId} (${result.agentURI})`);
 * } catch (err) {
 *   console.error("Registration failed:", err);
 * }
 * ```
 */
export async function registerAgent(
  options: RegisterAgentOptions
): Promise<RegistrationResult> {
  const { name, description, privateKey, walletAddress } = options;
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);

  console.log(`[registry] Registering agent "${name}" on ERC-8004 (${network})...`);

  // Get the RPC URL
  const rpcUrl = getRpcUrl();

  const pinataJwt = process.env.PINATA_JWT?.trim();
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  const useIpfs = Boolean(pinataJwt || ipfsNodeUrl);

  // Initialize the SDK with chain configuration and the agent's private key.
  const sdk = new SDK({
    chainId: config.chainId,
    rpcUrl,
    privateKey,
    ...(pinataJwt
      ? { ipfs: "pinata" as const, pinataJwt }
      : ipfsNodeUrl
        ? { ipfs: "node" as const, ipfsNodeUrl }
        : {}),
  });

  // Create the agent metadata
  const agent = sdk.createAgent(name, description, options.image);

  // Pin capabilities/endpoints into the registration file so they land in IPFS.
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    agent.setMetadata(options.metadata);
  }
  if (options.endpoints && options.endpoints.length > 0) {
    const file = agent.getRegistrationFile() as unknown as {
      endpoints?: { type: string; value: string }[];
    };
    file.endpoints = options.endpoints as never;
  }
  agent.setActive(true);

  if (useIpfs) {
    // IPFS mode: tokenURI becomes ipfs://<cid> with full metadata JSON.
    // First-time registration sends 2 txs internally (register + setAgentURI).
    const handle = await agent.registerIPFS();

    // waitMined resolves { receipt, result } where result is the
    // RegistrationFile containing agentURI = ipfs://<cid>.
    const mined = (await handle.waitMined()) as unknown as {
      result?: { agentURI?: string };
    };
    const agentId = agent.agentId ?? "unknown";
    const txHash = (handle as unknown as { hash?: string }).hash ?? "unknown";
    const agentURI =
      mined?.result?.agentURI ?? agent.agentURI ?? "unknown";

    console.log(`[registry] Agent registered successfully (IPFS mode).`);
    console.log(`[registry]   Agent ID: ${agentId}`);
    console.log(`[registry]   Token URI: ${agentURI}`);
    console.log(`[registry]   TX Hash: ${txHash}`);
    console.log(`[registry]   View on 8004scan: https://8004scan.com/agent/${agentId}`);

    return { agentId: String(agentId), txHash: String(txHash), agentURI: String(agentURI) };
  }

  // HTTP fallback (no IPFS configured): tokenURI has no pinned metadata,
  // so 8004scan shows the agent without name/description.
  console.warn(
    "[registry] PINATA_JWT/ IPFS_NODE_URL not set — falling back to HTTP mode (no IPFS metadata)."
  );
  const agentHttpUri = `https://8004scan.com/api/agent/${walletAddress}`;
  const handle = await agent.registerHTTP(agentHttpUri);

  // Wait for the transaction to be mined
  await handle.waitMined();
  const agentId = agent.agentId ?? "unknown";
  const txHash = (handle as unknown as { hash?: string }).hash ?? "unknown";

  console.log(`[registry] Agent registered successfully.`);
  console.log(`[registry]   Agent ID: ${agentId}`);
  console.log(`[registry]   TX Hash: ${txHash}`);
  console.log(`[registry]   View on 8004scan: https://8004scan.com/agent/${agentId}`);

  return { agentId: String(agentId), txHash: String(txHash), agentURI: agentHttpUri };
}
