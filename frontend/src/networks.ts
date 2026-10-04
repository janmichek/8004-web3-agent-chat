export type NetworkInfo = {
  chainId: number
  name: string
  /** Compact label for the wallet bar. */
  shortName: string
  explorerUrl: string
  /** 8004scan site listing this network's agents. */
  scanUrl: string
  /** Network segment of 8004scan agent URLs (`/agents/<scanSlug>/<tokenId>`). */
  scanSlug: string
  /** Keyless RPC for wallets: Web3Auth needs an absolute https URL. */
  publicRpcUrl: string
  /** Native gas token (defaults to ETH when omitted). */
  nativeCurrency?: { name: string; symbol: string; decimals: number }
}

const NETWORKS: NetworkInfo[] = [
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    explorerUrl: 'https://sepolia.arbiscan.io',
    scanUrl: 'https://testnet.8004scan.io',
    scanSlug: 'arbitrum-sepolia',
    publicRpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  },
  {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'Eth Sepolia',
    explorerUrl: 'https://sepolia.etherscan.io',
    scanUrl: 'https://testnet.8004scan.io',
    scanSlug: 'sepolia',
    publicRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    explorerUrl: 'https://arbiscan.io',
    scanUrl: 'https://8004scan.io',
    scanSlug: 'arbitrum-one',
    publicRpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
  {
    chainId: 5000,
    name: 'Mantle',
    shortName: 'Mantle',
    explorerUrl: 'https://mantlescan.io',
    scanUrl: 'https://8004scan.io',
    scanSlug: 'mantle',
    publicRpcUrl: 'https://rpc.mantle.xyz',
    nativeCurrency: { name: 'MNT', symbol: 'MNT', decimals: 18 },
  },
  {
    chainId: 5003,
    name: 'Mantle Sepolia',
    shortName: 'Mnt Sepolia',
    explorerUrl: 'https://sepolia.mantlescan.io',
    scanUrl: 'https://testnet.8004scan.io',
    scanSlug: 'mantle-sepolia',
    publicRpcUrl: 'https://rpc.sepolia.mantle.xyz',
    nativeCurrency: { name: 'MNT', symbol: 'MNT', decimals: 18 },
  },
]

export const DEFAULT_CHAIN_ID = 421614

/** Chains the dapp works on; the wallet is asked to be on one of these. */
export const SUPPORTED_CHAIN_IDS: readonly number[] = [421614, 11155111, 5003]

export const SUPPORTED_NETWORKS: NetworkInfo[] = NETWORKS.filter((n) =>
  SUPPORTED_CHAIN_IDS.includes(n.chainId),
)

export function findNetwork(chainId?: number): NetworkInfo | undefined {
  return NETWORKS.find((n) => n.chainId === chainId)
}

/** Network for a chain id, falling back to the default for unknown/missing ids. */
export function networkInfo(chainId?: number): NetworkInfo {
  return findNetwork(chainId) ?? findNetwork(DEFAULT_CHAIN_ID)!
}

export function isSupportedChain(chainId?: number): boolean {
  return chainId != null && SUPPORTED_CHAIN_IDS.includes(chainId)
}

/** Chain an ERC-8004 agent ID ("<chainId>:<tokenId>") lives on; undefined for a bare token ID. */
export function chainIdOfAgentId(agentId: string): number | undefined {
  const parts = agentId.split(':')
  if (parts.length < 2) return undefined
  const chainId = Number(parts[0])
  return Number.isInteger(chainId) ? chainId : undefined
}

export function addressExplorerUrl(address: string, chainId?: number): string {
  return `${networkInfo(chainId).explorerUrl}/address/${address}`
}

export function txExplorerUrl(txHash: string, chainId?: number): string {
  return `${networkInfo(chainId).explorerUrl}/tx/${txHash}`
}
