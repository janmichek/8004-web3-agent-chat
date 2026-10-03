import { getAccount, getWalletClient, switchChain } from '@wagmi/vue/actions'
import { arbitrumSepolia } from '@wagmi/vue/chains'
import type { Config } from '@wagmi/vue'
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem'

const ARB_SEPOLIA_HEX = `0x${arbitrumSepolia.id.toString(16)}` as Hex

/** Read the wallet's real chain id (not wagmi's configured-chain fallback). */
export async function getInjectedChainId(): Promise<number | undefined> {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined
  if (!provider?.request) return undefined
  const hex = (await provider.request({ method: 'eth_chainId' })) as string
  return Number.parseInt(hex, 16)
}

/** Same-origin proxy for in-page viem calls (Vite → API → Alchemy). */
export function appRpcUrl(): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/api/rpc`
  return '/api/rpc'
}

/** MetaMask talks to this URL directly (not via Vite), so use the API host. */
function walletRpcUrl(): string {
  return 'http://127.0.0.1:8787/api/rpc'
}

/**
 * Estimate nonce/gas/fees via the app RPC proxy so the wallet does not need
 * the public Arbitrum Sepolia endpoint (which rate-limits often).
 */
export async function prepareNativeTransfer(params: {
  account: Address
  to: Address
  value: bigint
}): Promise<{
  to: Address
  value: bigint
  gas: bigint
  nonce: number
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  chainId: number
}> {
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(appRpcUrl()),
  })
  const [nonce, gas, fees] = await Promise.all([
    client.getTransactionCount({ address: params.account }),
    client.estimateGas({
      account: params.account,
      to: params.to,
      value: params.value,
    }),
    client.estimateFeesPerGas(),
  ])
  return {
    to: params.to,
    value: params.value,
    gas,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    chainId: arbitrumSepolia.id,
  }
}

async function addArbitrumSepolia(): Promise<void> {
  const provider = window.ethereum
  if (!provider?.request) {
    throw new Error('No injected wallet found')
  }

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: ARB_SEPOLIA_HEX,
        chainName: 'Arbitrum Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        // Prefer local proxy → Alchemy. Public rollup RPC rate-limits often.
        rpcUrls: [walletRpcUrl()],
        blockExplorerUrls: ['https://sepolia.arbiscan.io'],
      },
    ],
  })
}

/**
 * Ensure the connected wallet is on Arbitrum Sepolia before sending.
 * Adds the chain if missing (injected wallets), then verifies chain id.
 */
export async function ensureArbitrumSepolia(config: Config): Promise<void> {
  if (getAccount(config).chainId === arbitrumSepolia.id) return

  const current = await getInjectedChainId()
  if (current === arbitrumSepolia.id) return

  try {
    await switchChain(config, { chainId: arbitrumSepolia.id })
  } catch {
    try {
      await addArbitrumSepolia()
      await switchChain(config, { chainId: arbitrumSepolia.id })
    } catch {
      // wallet_addEthereumChain often switches already
    }
  }

  let after = getAccount(config).chainId ?? (await getInjectedChainId())
  if (after !== arbitrumSepolia.id) {
    const client = await getWalletClient(config)
    if (client) {
      try {
        await client.switchChain({ id: arbitrumSepolia.id })
      } catch {
        try {
          await addArbitrumSepolia()
        } catch {
          // social / embedded wallets may not support wallet_addEthereumChain
        }
      }
    }
    after = getAccount(config).chainId ?? (await getInjectedChainId())
  }

  if (after !== arbitrumSepolia.id) {
    throw new Error(
      `Wallet is still on chain ${after ?? '?'}. Switch to Arbitrum Sepolia (421614), then retry.`,
    )
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
    Buffer: typeof Buffer
    process: typeof process
  }
}
