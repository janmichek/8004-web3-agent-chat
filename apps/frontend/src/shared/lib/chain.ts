import { getAccount, getWalletClient, switchChain } from "@wagmi/vue/actions";
import {
  arbitrum,
  arbitrumSepolia,
  mantle,
  mantleSepoliaTestnet,
  sepolia,
} from "@wagmi/vue/chains";
import type { Config } from "@wagmi/vue";
import { createPublicClient, http, type Address, type Chain, type Hex } from "viem";
import { networkInfo } from "../config";

const VIEM_CHAINS: Record<number, Chain> = {
  [arbitrumSepolia.id]: arbitrumSepolia,
  [sepolia.id]: sepolia,
  [arbitrum.id]: arbitrum,
  [mantle.id]: mantle,
  [mantleSepoliaTestnet.id]: mantleSepoliaTestnet,
};

function viemChain(chainId: number): Chain {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  return chain;
}

/** Read the wallet's real chain id (not wagmi's configured-chain fallback). */
export async function getInjectedChainId(): Promise<number | undefined> {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!provider?.request) return undefined;
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

/** Same-origin proxy for in-page viem calls (Vite → API → the chain's RPC). */
function appRpcUrl(chainId: number): string {
  return `${window.location.origin}/api/rpc?chainId=${chainId}`;
}

/** MetaMask talks to this URL directly (not via Vite), so use the API host. */
function walletRpcUrl(chainId: number): string {
  return `http://127.0.0.1:8787/api/rpc?chainId=${chainId}`;
}

/**
 * Estimate gas/fees via the app RPC proxy so the wallet does not need the
 * chain's public endpoint (which rate-limits often). Nonce is omitted on
 * purpose — injected wallets must set it for the authorized account.
 */
export async function prepareNativeTransfer(params: {
  account: Address;
  to: Address;
  value: bigint;
  chainId: number;
}): Promise<{
  to: Address;
  value: bigint;
  gas: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  chainId: number;
}> {
  const client = createPublicClient({
    chain: viemChain(params.chainId),
    transport: http(appRpcUrl(params.chainId)),
  });
  const [gas, fees] = await Promise.all([
    client.estimateGas({
      account: params.account,
      to: params.to,
      value: params.value,
    }),
    client.estimateFeesPerGas(),
  ]);
  // ~20% headroom — Sepolia fresh-account funding sits near the estimate
  // (~204k/207k); Web3Auth's 21_000 default OOGs every time without this.
  const gasWithBuffer = gas + gas / 5n;
  return {
    to: params.to,
    value: params.value,
    gas: gasWithBuffer,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: params.chainId,
  };
}

function addChainParams(chainId: number) {
  const network = networkInfo(chainId);
  const native = network.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 };
  return {
    chainId: `0x${chainId.toString(16)}` as Hex,
    chainName: network.name,
    nativeCurrency: native,
    // Prefer local proxy → configured RPC. Public RPCs rate-limit often.
    rpcUrls: [walletRpcUrl(chainId)],
    blockExplorerUrls: [network.explorerUrl],
  };
}

/** Add chain via the connected wagmi client (Web3Auth / MetaMask session). */
async function addChainViaWallet(config: Config, chainId: number): Promise<void> {
  const client = await getWalletClient(config);
  if (client) {
    await client.request({
      method: "wallet_addEthereumChain",
      params: [addChainParams(chainId)],
    });
    return;
  }

  // Last resort: injected extension. Prefer the connected client above —
  // window.ethereum may be a different wallet than the Web3Auth session.
  const provider = window.ethereum;
  if (!provider?.request) {
    throw new Error("No wallet found");
  }
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [addChainParams(chainId)],
  });
}

/**
 * Ensure the connected wallet is on `chainId` before sending.
 * Adds the chain if missing, then verifies chain id against wagmi state.
 */
export async function ensureChain(config: Config, chainId: number): Promise<void> {
  if (getAccount(config).chainId === chainId) return;

  try {
    await switchChain(config, { chainId });
  } catch {
    try {
      await addChainViaWallet(config, chainId);
      await switchChain(config, { chainId });
    } catch {
      // wallet_addEthereumChain often switches already
    }
  }

  let after = getAccount(config).chainId;
  if (after !== chainId) {
    const client = await getWalletClient(config);
    if (client) {
      try {
        await client.switchChain({ id: chainId });
      } catch {
        try {
          await addChainViaWallet(config, chainId);
        } catch {
          // social / embedded wallets may not support wallet_addEthereumChain
        }
      }
    }
    after = getAccount(config).chainId;
  }

  // Fall back to injected ethereum only for verification when wagmi has no chainId.
  if (after == null) {
    after = await getInjectedChainId();
  }

  if (after !== chainId) {
    throw new Error(
      `Wallet is still on chain ${after ?? "?"}. Switch to ${networkInfo(chainId).name} (${chainId}), then retry.`,
    );
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    Buffer: typeof Buffer;
    process: typeof process;
  }
}
