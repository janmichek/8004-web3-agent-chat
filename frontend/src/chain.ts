import { getWalletClient, switchChain } from '@wagmi/vue/actions'
import { arbitrumSepolia } from '@wagmi/vue/chains'
import type { Hex } from 'viem'
import { config } from './wagmi'

const ARB_SEPOLIA_HEX = `0x${arbitrumSepolia.id.toString(16)}` as Hex

/** Read the wallet's real chain id (not wagmi's configured-chain fallback). */
export async function getInjectedChainId(): Promise<number | undefined> {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined
  if (!provider?.request) return undefined
  const hex = (await provider.request({ method: 'eth_chainId' })) as string
  return Number.parseInt(hex, 16)
}

/** MetaMask talks to this URL directly (not via Vite), so use the API host. */
function walletRpcUrl(): string {
  return 'http://127.0.0.1:8787/api/rpc'
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
 * Ensure the injected wallet is on Arbitrum Sepolia before sending.
 * Adds the chain if missing, then verifies eth_chainId.
 */
export async function ensureArbitrumSepolia(): Promise<void> {
  const current = await getInjectedChainId()
  if (current === arbitrumSepolia.id) return

  try {
    await switchChain(config, { chainId: arbitrumSepolia.id })
  } catch {
    await addArbitrumSepolia()
    try {
      await switchChain(config, { chainId: arbitrumSepolia.id })
    } catch {
      // wallet_addEthereumChain often switches already
    }
  }

  // Prefer wallet client switch if still wrong
  let after = await getInjectedChainId()
  if (after !== arbitrumSepolia.id) {
    const client = await getWalletClient(config)
    if (client) {
      try {
        await client.switchChain({ id: arbitrumSepolia.id })
      } catch {
        await addArbitrumSepolia()
      }
    }
    after = await getInjectedChainId()
  }

  if (after !== arbitrumSepolia.id) {
    throw new Error(
      `Wallet is still on chain ${after ?? '?'}. Switch MetaMask to Arbitrum Sepolia (421614), then retry.`,
    )
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
  }
}
