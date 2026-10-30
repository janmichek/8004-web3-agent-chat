import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@wagmi/vue'

const wagmi = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
}))
vi.mock('@wagmi/vue/actions', () => wagmi)

const viem = vi.hoisted(() => ({
  estimateGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
}))
vi.mock('viem', async (orig) => ({
  ...(await orig<typeof import('viem')>()),
  createPublicClient: () => viem,
  http: (url: string) => url,
}))

import { ensureChain, getInjectedChainId, prepareNativeTransfer } from './chain'

const config = {} as Config
const ARB_SEPOLIA = 421614

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { location: { origin: 'http://app.test' } })
})
afterEach(() => vi.unstubAllGlobals())

describe('getInjectedChainId', () => {
  it('returns undefined without an injected provider', async () => {
    expect(await getInjectedChainId()).toBeUndefined()
  })

  it('parses the hex chain id from eth_chainId', async () => {
    const request = vi.fn().mockResolvedValue('0x66eee')
    vi.stubGlobal('window', { ethereum: { request } })
    expect(await getInjectedChainId()).toBe(ARB_SEPOLIA)
    expect(request).toHaveBeenCalledWith({ method: 'eth_chainId' })
  })
})

describe('prepareNativeTransfer', () => {
  const params = {
    account: '0x0000000000000000000000000000000000000001' as const,
    to: '0x0000000000000000000000000000000000000002' as const,
    value: 10n,
    chainId: ARB_SEPOLIA,
  }

  it('adds 20% gas headroom and forwards fee estimates', async () => {
    viem.estimateGas.mockResolvedValue(100_000n)
    viem.estimateFeesPerGas.mockResolvedValue({ maxFeePerGas: 5n, maxPriorityFeePerGas: 2n })
    const tx = await prepareNativeTransfer(params)
    expect(tx).toEqual({
      to: params.to,
      value: 10n,
      gas: 120_000n,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 2n,
      chainId: ARB_SEPOLIA,
    })
  })

  it('rejects unsupported chains before touching the network', async () => {
    await expect(prepareNativeTransfer({ ...params, chainId: 1 })).rejects.toThrow(
      'Unsupported chain 1',
    )
    expect(viem.estimateGas).not.toHaveBeenCalled()
  })
})

describe('ensureChain', () => {
  it('does nothing when the wallet is already on the chain', async () => {
    wagmi.getAccount.mockReturnValue({ chainId: ARB_SEPOLIA })
    await ensureChain(config, ARB_SEPOLIA)
    expect(wagmi.switchChain).not.toHaveBeenCalled()
  })

  it('switches chain and verifies the result', async () => {
    wagmi.getAccount
      .mockReturnValueOnce({ chainId: 1 })
      .mockReturnValueOnce({ chainId: ARB_SEPOLIA })
    wagmi.switchChain.mockResolvedValue(undefined)
    await ensureChain(config, ARB_SEPOLIA)
    expect(wagmi.switchChain).toHaveBeenCalledWith(config, { chainId: ARB_SEPOLIA })
  })

  it('adds the chain through the wallet client when switching fails', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    wagmi.getAccount
      .mockReturnValueOnce({ chainId: 1 })
      .mockReturnValueOnce({ chainId: ARB_SEPOLIA })
    wagmi.switchChain.mockRejectedValueOnce(new Error('unknown chain')).mockResolvedValue(undefined)
    wagmi.getWalletClient.mockResolvedValue({ request })
    await ensureChain(config, ARB_SEPOLIA)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_addEthereumChain' }),
    )
  })

  it('throws a readable error when the wallet stays on another chain', async () => {
    wagmi.getAccount.mockReturnValue({ chainId: 1 })
    wagmi.switchChain.mockRejectedValue(new Error('nope'))
    wagmi.getWalletClient.mockResolvedValue(undefined)
    await expect(ensureChain(config, ARB_SEPOLIA)).rejects.toThrow(/still on chain 1.*421614/)
  })

  it('falls back to the injected chain id for verification', async () => {
    wagmi.getAccount.mockReturnValue({ chainId: undefined })
    wagmi.switchChain.mockResolvedValue(undefined)
    wagmi.getWalletClient.mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      ethereum: { request: vi.fn().mockResolvedValue('0x66eee') },
    })
    await expect(ensureChain(config, ARB_SEPOLIA)).resolves.toBeUndefined()
  })
})
