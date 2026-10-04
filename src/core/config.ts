/**
 * Network configuration and provider management.
 * @module config
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ethers } from "ethers";
import type { NetworkName, NetworkConfig } from "./types.js";

/**
 * Registry of supported networks.
 * Each entry maps a NetworkName to its chain ID, RPC URL template, and env var.
 */
const NETWORKS: Record<NetworkName, NetworkConfig> = {
  "arbitrum-sepolia": {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    defaultRpcUrl: "https://arb-sepolia.g.alchemy.com/v2",
    publicRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    scanSlug: "arbitrum-sepolia",
    testnet: true,
  },
  "ethereum-sepolia": {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    defaultRpcUrl: "https://eth-sepolia.g.alchemy.com/v2",
    publicRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    scanSlug: "sepolia",
    testnet: true,
  },
  "arbitrum-one": {
    name: "Arbitrum One",
    chainId: 42161,
    defaultRpcUrl: "https://arb-mainnet.g.alchemy.com/v2",
    publicRpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    scanSlug: "arbitrum-one",
    testnet: false,
  },
  // NOTE: Chain ID 23888 for Robinhood Testnet should be verified before production use.
  "robinhood-testnet": {
    name: "Robinhood Testnet",
    chainId: 46630,
    defaultRpcUrl: "https://robinhood-testnet.g.alchemy.com/v2",
    testnet: true,
  },
};

/** Networks the dapp offers besides the NETWORK default. */
const DAPP_NETWORKS: NetworkName[] = ["arbitrum-sepolia", "ethereum-sepolia"];

/** Network of the request/agent currently being served (see {@link runWithNetwork}). */
const networkScope = new AsyncLocalStorage<NetworkName>();

/** Process-wide override of the NETWORK default (see {@link setProcessNetwork}). */
let processNetwork: NetworkName | undefined;

/**
 * Makes `network` the active network for the whole process, for single-agent
 * processes (standalone MCP server) where there is no request to scope.
 * `RPC_URL` still belongs to the NETWORK default.
 */
export function setProcessNetwork(network: NetworkName): void {
  processNetwork = network;
}

/**
 * Runs `fn` with `network` as the active network. Everything it calls or
 * awaits (providers, SDKs, agent tools) resolves that network instead of the
 * NETWORK default, so concurrent requests can target different chains.
 */
export function runWithNetwork<T>(network: NetworkName, fn: () => T): T {
  return networkScope.run(network, fn);
}

/**
 * Returns the default network name from the NETWORK environment variable.
 * Defaults to "arbitrum-sepolia" if not set.
 *
 * @throws If the NETWORK value is not a supported network.
 */
export function getDefaultNetwork(): NetworkName {
  const raw = process.env.NETWORK || "arbitrum-sepolia";
  if (!(raw in NETWORKS)) {
    throw new Error(
      `Unsupported network "${raw}". Supported networks: ${Object.keys(NETWORKS).join(", ")}`
    );
  }
  return raw as NetworkName;
}

/**
 * Returns the active network: the one set by {@link runWithNetwork}, else by
 * {@link setProcessNetwork}, else the NETWORK default.
 *
 * @returns The active network name.
 * @throws If the NETWORK value is not a supported network.
 */
export function getActiveNetwork(): NetworkName {
  return networkScope.getStore() ?? processNetwork ?? getDefaultNetwork();
}

/** Networks agents can be created on: the NETWORK default first, then the dapp's. */
export function getSupportedNetworks(): NetworkName[] {
  return [...new Set([getDefaultNetwork(), ...DAPP_NETWORKS])];
}

/** Resolves a chain ID to one of {@link getSupportedNetworks}, or undefined. */
export function getSupportedNetworkByChainId(chainId: unknown): NetworkName | undefined {
  const id = Number(chainId);
  return getSupportedNetworks().find((n) => NETWORKS[n].chainId === id);
}

/**
 * Returns the configuration for a given network.
 *
 * @param network - The network name. Defaults to the active network.
 * @returns The network configuration object.
 */
export function getNetworkConfig(network?: NetworkName): NetworkConfig {
  const name = network ?? getActiveNetwork();
  return NETWORKS[name];
}

/** Env var holding a network's own RPC endpoint, e.g. RPC_URL_ETHEREUM_SEPOLIA. */
export function getRpcEnvVar(network: NetworkName): string {
  return `RPC_URL_${network.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Returns the RPC endpoint URL for a network.
 *
 * Order: `RPC_URL_<NETWORK>`, then `RPC_URL` (default network only), then the
 * network's public RPC (other networks only, so a second chain works without
 * extra setup).
 *
 * @param network - The network name. Defaults to the active network.
 * @returns The RPC endpoint URL.
 * @throws If no endpoint is configured.
 */
export function getRpcUrl(network?: NetworkName): string {
  const name = network ?? getActiveNetwork();
  const envVar = getRpcEnvVar(name);
  const own = process.env[envVar]?.trim();
  if (own) return own;

  const isDefault = name === getDefaultNetwork();
  if (isDefault && process.env.RPC_URL) return process.env.RPC_URL;
  const publicRpcUrl = NETWORKS[name].publicRpcUrl;
  if (!isDefault && publicRpcUrl) return publicRpcUrl;

  throw new Error(
    `Missing RPC endpoint for ${NETWORKS[name].name}. Set the ` +
      `${isDefault ? `RPC_URL or ${envVar}` : envVar} environment variable.\n` +
      `Example: ${NETWORKS[name].defaultRpcUrl}/YOUR_API_KEY`
  );
}

/**
 * Returns an ethers JsonRpcProvider for a network.
 *
 * @param network - The network name. Defaults to the active network.
 * @returns A configured ethers JsonRpcProvider.
 * @throws If no RPC endpoint is configured.
 */
export function getProvider(network?: NetworkName): ethers.JsonRpcProvider {
  const config = getNetworkConfig(network);
  const rpcUrl = getRpcUrl(network);
  return new ethers.JsonRpcProvider(rpcUrl, config.chainId);
}

/**
 * Returns the chain ID for the active network.
 *
 * @param network - The network name. Defaults to the active network.
 * @returns The EVM chain ID.
 */
export function getChainId(network?: NetworkName): number {
  return getNetworkConfig(network).chainId;
}

/** Returns the network for a chain ID, or undefined if unknown. */
export function findNetworkByChainId(chainId: number): NetworkName | undefined {
  for (const [slug, config] of Object.entries(NETWORKS)) {
    if (config.chainId === chainId) return slug as NetworkName;
  }
  return undefined;
}

/**
 * Returns the URL slug (NetworkName key, e.g. "arbitrum-sepolia") for a given chain ID.
 * Falls back to "arbitrum-sepolia" if unknown.
 */
export function getNetworkSlugByChainId(chainId: number): NetworkName {
  return findNetworkByChainId(chainId) ?? "arbitrum-sepolia";
}

/**
 * Returns the human-readable network name for a given chain ID.
 * Falls back to "Chain {chainId}" if unknown.
 */
export function getNetworkNameByChainId(chainId: number): string {
  const network = findNetworkByChainId(chainId);
  return network ? NETWORKS[network].name : `Chain ${chainId}`;
}

/**
 * Network an ERC-8004 agent ID ("<chainId>:<tokenId>") lives on.
 * Undefined for a bare token ID or an unknown chain.
 */
export function findNetworkByAgentId(agentId: string): NetworkName | undefined {
  const parts = agentId.split(":");
  return parts.length > 1 ? findNetworkByChainId(Number(parts[0])) : undefined;
}

/** 8004scan page of an agent. `network` applies to bare token IDs; defaults to the active network. */
export function getAgentScanUrl(agentId: string, network?: NetworkName): string {
  const name = findNetworkByAgentId(agentId) ?? network ?? getActiveNetwork();
  const config = NETWORKS[name];
  const base = config.testnet ? "https://testnet.8004scan.io" : "https://8004scan.io";
  return `${base}/agents/${config.scanSlug ?? name}/${agentId.split(":").pop()}`;
}
