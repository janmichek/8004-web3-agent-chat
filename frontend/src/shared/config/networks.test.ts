import { describe, expect, it } from 'vitest'
import {
  addressExplorerUrl,
  chainIdOfAgentId,
  findNetwork,
  isSupportedChain,
  networkInfo,
  txExplorerUrl,
} from './networks'

describe('findNetwork', () => {
  it('returns the network for a known chain id', () => {
    expect(findNetwork(421614)?.name).toBe('Arbitrum Sepolia')
    expect(findNetwork(11155111)?.name).toBe('Ethereum Sepolia')
    expect(findNetwork(42161)?.name).toBe('Arbitrum One')
  })

  it('returns undefined for unknown chain ids', () => {
    expect(findNetwork(99999)).toBeUndefined()
    expect(findNetwork(1)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(findNetwork(undefined)).toBeUndefined()
  })
})

describe('networkInfo', () => {
  it('falls back to default chain id (421614) for unknown ids', () => {
    expect(networkInfo(99999).chainId).toBe(421614)
    expect(networkInfo(99999).name).toBe('Arbitrum Sepolia')
  })

  it('falls back to default for undefined', () => {
    expect(networkInfo(undefined).chainId).toBe(421614)
  })

  it('returns the exact network for known ids', () => {
    expect(networkInfo(5003).name).toBe('Mantle Sepolia')
    expect(networkInfo(5000).nativeCurrency?.symbol).toBe('MNT')
  })
})

describe('isSupportedChain', () => {
  it('returns true for supported chains', () => {
    expect(isSupportedChain(421614)).toBe(true)
    expect(isSupportedChain(11155111)).toBe(true)
    expect(isSupportedChain(5003)).toBe(true)
  })

  it('returns false for unsupported chains', () => {
    expect(isSupportedChain(1)).toBe(false)
    expect(isSupportedChain(42161)).toBe(false) // Arbitrum One is in NETWORKS but not SUPPORTED_CHAIN_IDS
    expect(isSupportedChain(5000)).toBe(false)
    expect(isSupportedChain(undefined)).toBe(false)
    expect(isSupportedChain(null as unknown as number)).toBe(false)
  })
})

describe('chainIdOfAgentId', () => {
  it('parses the chain id from a prefixed agent id', () => {
    expect(chainIdOfAgentId('421614:7')).toBe(421614)
    expect(chainIdOfAgentId('11155111:204')).toBe(11155111)
  })

  it('returns undefined for bare token ids', () => {
    expect(chainIdOfAgentId('7')).toBeUndefined()
    expect(chainIdOfAgentId('')).toBeUndefined()
    expect(chainIdOfAgentId('not-a-number:7')).toBeUndefined()
  })
})

describe('addressExplorerUrl', () => {
  it('builds an explorer address URL for a chain id', () => {
    expect(addressExplorerUrl('0xabc', 421614)).toBe('https://sepolia.arbiscan.io/address/0xabc')
    expect(addressExplorerUrl('0xabc', 11155111)).toBe('https://sepolia.etherscan.io/address/0xabc')
  })

  it('uses the default network when chain id is unknown', () => {
    expect(addressExplorerUrl('0xabc', 99999)).toBe('https://sepolia.arbiscan.io/address/0xabc')
  })
})

describe('txExplorerUrl', () => {
  it('builds an explorer tx URL for a chain id', () => {
    expect(txExplorerUrl('0x1234', 421614)).toBe('https://sepolia.arbiscan.io/tx/0x1234')
    expect(txExplorerUrl('0x1234', 11155111)).toBe('https://sepolia.etherscan.io/tx/0x1234')
  })

  it('uses the default network when chain id is unknown', () => {
    expect(txExplorerUrl('0x1234', undefined)).toBe('https://sepolia.arbiscan.io/tx/0x1234')
  })
})
