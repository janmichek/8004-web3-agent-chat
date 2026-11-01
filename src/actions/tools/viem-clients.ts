import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainId, getRpcUrl } from "../../core/config.js";

/** viem chain object for the agent's active network. */
function getAgentChain(): Chain {
  const rpcUrl = getRpcUrl();
  return defineChain({
    id: getChainId(),
    name: "Arbitrum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function getAgentPublicClient(): PublicClient {
  return createPublicClient({ chain: getAgentChain(), transport: http(getRpcUrl()) });
}

export function getAgentWalletClient(privateKey: `0x${string}`): {
  account: Account;
  walletClient: WalletClient<Transport, Chain, Account>;
} {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: getAgentChain(),
    transport: http(getRpcUrl()),
  });
  return { account, walletClient };
}
