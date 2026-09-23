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
import { toGatewayUrl, uploadJson } from "./ipfs.js";
import { buildOasfService } from "./oasf.js";

/**
 * Registers an agent on the ERC-8004 Identity Registry.
 *
 * Owner-as-creator flow (matches 8004-identity-nft `register(agentURI)` from
 * the EOA):
 * - `options.privateKey` = owner/master signer → on-chain `creator` + `owner`.
 * - `options.walletAddress` = operational agent wallet → on-chain `agentWallet`
 *   via `setAgentWallet` (EIP-712 sig from `options.agentWalletPrivateKey`).
 * - Omit `agentWalletPrivateKey` (or pass signer == wallet) for legacy
 *   self-registration where creator == agent wallet.
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
 *     privateKey: masterWallet.privateKey, // creator + owner
 *     walletAddress: agentWallet.address, // operational wallet
 *     agentWalletPrivateKey: agentWallet.privateKey, // EIP-712 sig
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
  const { name, description, privateKey, walletAddress, agentWalletPrivateKey } = options;
  const network = getActiveNetwork();
  const config = getNetworkConfig(network);

  const { Wallet } = await import("ethers");
  const signerAddress = new Wallet(privateKey).address;
  const needsAgentWallet =
    walletAddress.toLowerCase() !== signerAddress.toLowerCase();

  console.log(`[registry] Registering agent "${name}" on ERC-8004 (${network})...`);
  console.log(`[registry]   Creator/owner (signer): ${signerAddress}`);
  console.log(`[registry]   Agent wallet: ${walletAddress}`);

  // Get the RPC URL
  const rpcUrl = getRpcUrl();

  const pinataJwt = process.env.PINATA_JWT?.trim();
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  const useIpfs = Boolean(pinataJwt || ipfsNodeUrl);

  // Initialize the SDK with chain configuration and the owner's private key.
  // The signer becomes on-chain creator + owner (8004-identity-nft parity).
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

  // Create the agent metadata — image must be an https gateway URL, not ipfs://.
  const image = options.image ? toGatewayUrl(options.image) : undefined;
  const agent = sdk.createAgent(name, description, image);

  // Pin capabilities/endpoints into the registration file so they land in IPFS.
  // Always include `updatedAt` (unix seconds) at the moment of creation so
  // on-chain metadata carries a creation timestamp.
  const updatedAt = Math.floor(Date.now() / 1000);
  agent.setMetadata({ ...options.metadata, updatedAt });
  if (options.endpoints && options.endpoints.length > 0) {
    const file = agent.getRegistrationFile() as unknown as {
      endpoints?: { type: string; value: string }[];
    };
    file.endpoints = options.endpoints as never;
  }
  agent.setActive(options.active !== false);

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
    let agentURI =
      mined?.result?.agentURI ?? agent.agentURI ?? "unknown";

    console.log(`[registry] Agent registered successfully (IPFS mode).`);
    console.log(`[registry]   Agent ID: ${agentId}`);
    console.log(`[registry]   TX Hash: ${txHash}`);
    console.log(`[registry]   View on 8004scan: https://8004scan.com/agent/${agentId}`);

    await bindAgentWallet(agent, walletAddress, agentWalletPrivateKey, needsAgentWallet);

    // The SDK's tokenURI file carries only the fixed ERC-8004 schema, so the
    // Metadata tab on 8004scan never shows custom keys (actions/tools/
    // updatedAt). Re-pin an enriched file that also carries `metadata` and
    // point the tokenURI at it.
    try {
      agentURI = await pinEnrichedRegistrationFile(sdk, agent, options, updatedAt, config.chainId);
      console.log(`[registry]   Enriched Token URI: ${agentURI}`);
    } catch (err) {
      console.warn(
        `[registry] Enriched metadata pin failed, keeping SDK URI: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { agentId: String(agentId), txHash: String(txHash), agentURI: String(agentURI), updatedAt };
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

  await bindAgentWallet(agent, walletAddress, agentWalletPrivateKey, needsAgentWallet);

  return { agentId: String(agentId), txHash: String(txHash), agentURI: agentHttpUri, updatedAt: Math.floor(Date.now() / 1000) };
}

/**
 * Re-pin the registration file with a top-level `metadata` section
 * (actions/tools/updatedAt/...) so 8004scan's Metadata tab — which renders
 * the tokenURI JSON, not contract storage — actually shows it.
 *
 * Unknown top-level fields are ignored by ERC-8004 consumers, and the owner
 * (already the tx signer here) pays for the extra `setAgentURI` call.
 *
 * @returns The new `ipfs://<cid>` URI.
 */
async function pinEnrichedRegistrationFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdk: { identityRegistryAddress: () => string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: { getRegistrationFile: () => any; setAgentURI: (...args: any[]) => Promise<any> },
  options: RegisterAgentOptions,
  updatedAt: number,
  chainId: number,
): Promise<string> {
  const file = agent.getRegistrationFile() as {
    name: string;
    description: string;
    image?: string;
    endpoints?: { type: string; value: string; meta?: Record<string, unknown> }[];
    trustModels?: string[];
    active?: boolean;
    x402support?: boolean;
    agentId?: string;
  };
  const tokenId = Number(String(file.agentId ?? "").split(":").pop());
  if (!Number.isFinite(tokenId)) throw new Error("Missing agentId, cannot enrich registration file");

  const enriched: Record<string, unknown> = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: file.name,
    description: file.description,
    services: buildEnrichedServices(file.endpoints ?? [], options.metadata),
    registrations: [
      {
        agentId: tokenId,
        agentRegistry: `eip155:${chainId}:${sdk.identityRegistryAddress()}`,
      },
    ],
    active: file.active ?? true,
    x402Support: file.x402support ?? false,
    metadata: { ...options.metadata, updatedAt },
  };
  if (file.image) enriched.image = file.image;
  if (file.trustModels?.length) enriched.supportedTrust = file.trustModels;

  const cid = await uploadJson(enriched, "agent-registration.json");
  const uri = `ipfs://${cid}`;
  const handle = (await agent.setAgentURI(uri)) as { waitMined: () => Promise<unknown> } | undefined;
  if (handle) await handle.waitMined();
  return uri;
}

/**
 * Map registration endpoints to the ERC-8004 `services` array, appending an
 * `oasf` service entry when OASF domains/skills are present in metadata.
 *
 * 8004scan renders its OASF card from `services[].name === "oasf"` with
 * `skills` as numeric-string IDs and `domains` as snake_case slugs — numeric
 * domain IDs stored in `metadata.oasfDomains` alone are not rendered.
 */
function buildEnrichedServices(
  endpoints: { type: string; value: string; meta?: Record<string, unknown> }[],
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  const services: Record<string, unknown>[] = endpoints.map((ep) => ({
    name: ep.type,
    endpoint: ep.value,
    ...ep.meta,
  }));
  const domains = Array.isArray(metadata?.oasfDomains)
    ? (metadata.oasfDomains as unknown[]).filter((d): d is string => typeof d === "string")
    : [];
  const skills = Array.isArray(metadata?.oasfSkills)
    ? (metadata.oasfSkills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  if (domains.length === 0 && skills.length === 0) return services;
  if (services.some((s) => String(s.name).toLowerCase() === "oasf")) return services;

  // 8004scan does not health-check `oasf` services, so anchor the descriptor
  // URL on the agent's first public https endpoint (origin + /oasf).
  const httpsEndpoint = endpoints.find((ep) => /^https:\/\/.+/i.test(ep.value))?.value;
  let oasfEndpoint = "https://example.com/oasf";
  if (httpsEndpoint) {
    try {
      oasfEndpoint = `${new URL(httpsEndpoint).origin}/oasf`;
    } catch {
      oasfEndpoint = httpsEndpoint;
    }
  }
  services.push(buildOasfService(domains, skills, oasfEndpoint));
  return services;
}

/**
 * Binds the operational agent wallet on-chain via `setAgentWallet`.
 *
 * No-op for legacy self-registration (signer == agent wallet).
 * Requires the agent wallet's private key to produce the EIP-712
 * `AgentWalletSet` signature; the owner/master pays gas.
 */
async function bindAgentWallet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: { setWallet: (...args: any[]) => Promise<any> },
  walletAddress: string,
  agentWalletPrivateKey: string | undefined,
  needsAgentWallet: boolean,
): Promise<void> {
  if (!needsAgentWallet) return;
  if (!agentWalletPrivateKey) {
    console.warn(
      `[registry] Agent wallet ${walletAddress} differs from signer — ` +
        `skipping on-chain setAgentWallet (no agentWalletPrivateKey provided).`
    );
    return;
  }
  console.log(`[registry] Binding on-chain agentWallet ${walletAddress} (owner pays gas)...`);
  const setHandle = (await agent.setWallet(walletAddress, {
    newWalletPrivateKey: agentWalletPrivateKey,
  })) as { waitMined: () => Promise<unknown> } | undefined;
  if (setHandle) await setHandle.waitMined();
  console.log(`[registry]   agentWallet bound: ${walletAddress}`);
}
