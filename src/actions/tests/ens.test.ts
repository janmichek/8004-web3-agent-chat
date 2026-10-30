// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getEnsAddress = vi.fn()
const getEnsName = vi.fn()
const writeContract = vi.fn()
const waitForTransactionReceipt = vi.fn()
const readContract = vi.fn()
const getBalance = vi.fn()
const getCode = vi.fn()
const getBlock = vi.fn()

const AGENT = '0x1234567890AbcdEF1234567890aBcdef12345678'
const RESOLVER = '0x00000000000000000000000000000000000000AA'

/** Registrar/registry/token reads, keyed by function name. */
let reads: Record<string, unknown>

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getEnsAddress,
      getEnsName,
      waitForTransactionReceipt,
      readContract,
      getBalance,
      getCode,
      getBlock,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract,
      chain: { id: 421614 },
    })),
    http: vi.fn(),
    defineChain: vi.fn((chain: unknown) => chain),
  }
})

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x1234567890AbcdEF1234567890aBcdef12345678',
  })),
}))

vi.mock('../../core/config.js', () => ({
  getRpcUrl: () => 'http://localhost:8545',
  getChainId: () => 421614,
  getActiveNetwork: () => 'arbitrum-sepolia',
  getNetworkConfig: () => ({
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    testnet: true,
    explorerUrl: 'https://sepolia.arbiscan.io',
  }),
}))

describe('ens tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      'AGENT_PRIVATE_KEY',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )
    getEnsAddress.mockResolvedValue('0x1234567890AbcdEF1234567890aBcdef12345678')
    getEnsName.mockResolvedValue('mybot.eth')
    writeContract.mockResolvedValue('0xabc123')
    waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
    reads = {
      predictProxyAddress: RESOLVER,
      isAvailable: true,
      getRegisterPrice: [8_000_000n, 0n],
      balanceOf: 0n,
      allowance: 0n,
      makeCommitment: `0x${'11'.repeat(32)}`,
      MIN_COMMITMENT_AGE: 60n,
      MAX_COMMITMENT_AGE: 86400n,
      commitmentAt: 0n,
      getOwner: AGENT,
      getResolver: RESOLVER,
    }
    readContract.mockImplementation(({ functionName }: { functionName: string }) =>
      Promise.resolve(reads[functionName]),
    )
    getBalance.mockResolvedValue(10n ** 18n)
    getCode.mockResolvedValue(undefined)
    getBlock.mockResolvedValue({ timestamp: 1_000_000n })
  })

  const writes = () => writeContract.mock.calls.map(([request]) => request.functionName)

  it('resolve_ens returns an address', async () => {
    const { resolveEnsTool } = await import('../tools/ens.tool.js')
    const result = await resolveEnsTool.invoke({ name: 'mybot.eth' })
    expect(result).toBe('0x1234567890AbcdEF1234567890aBcdef12345678')
    expect(getEnsAddress).toHaveBeenCalled()
  })

  it('lookup_ens returns primary name for agent wallet', async () => {
    const { lookupEnsTool } = await import('../tools/ens.tool.js')
    const result = await lookupEnsTool.invoke({})
    expect(result).toBe('mybot.eth')
  })

  it('lookup_ens reports when no primary name is set', async () => {
    getEnsName.mockResolvedValueOnce(null)
    const { lookupEnsTool } = await import('../tools/ens.tool.js')
    const result = await lookupEnsTool.invoke({
      address: '0x1234567890AbcdEF1234567890aBcdef12345678',
    })
    expect(result).toContain('No primary ENS name')
  })

  it('set_primary_ens rejects mismatched forward resolution', async () => {
    getEnsAddress.mockResolvedValueOnce('0x0000000000000000000000000000000000000001')
    const { setPrimaryEnsTool } = await import('../tools/ens.tool.js')
    const result = await setPrimaryEnsTool.invoke({ name: 'mybot.eth' })
    expect(result).toContain('Error')
    expect(result).toContain('resolves to')
    expect(writeContract).not.toHaveBeenCalled()
  })

  it('set_primary_ens writes reverse record when resolution matches', async () => {
    const { setPrimaryEnsTool } = await import('../tools/ens.tool.js')
    const result = await setPrimaryEnsTool.invoke({ name: 'mybot.eth' })
    expect(result).toContain('Primary ENS name set to mybot.eth')
    expect(result).toContain('0xabc123')
    expect(writeContract).toHaveBeenCalled()
  })

  it('set_primary_ens returns error without private key', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '')
    const { setPrimaryEnsTool } = await import('../tools/ens.tool.js')
    const result = await setPrimaryEnsTool.invoke({ name: 'mybot.eth' })
    expect(result).toContain('Error')
    expect(result).toContain('AGENT_PRIVATE_KEY')
  })

  it('register_ens runs the full flow for an available name', async () => {
    // The commitment only exists once commit has been sent.
    writeContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'commit') reads.commitmentAt = 100n
      return Promise.resolve('0xabc123')
    })
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'MyBot' })
    expect(result).toContain('mybot.eth now resolves to')
    expect(result).toContain('primary name')
    expect(result).toContain('paid 8 USDC')
    // Arbitrum Sepolia agent: L1 address record plus the L2 coin type, then the L2 reverse record.
    expect(writes()).toEqual([
      'deployProxy',
      'mint',
      'approve',
      'commit',
      'register',
      'setAddress',
      'setAddress',
      'setName',
    ])
  })

  it('register_ens reuses the resolver, funds, and an earlier commitment', async () => {
    getCode.mockResolvedValue('0x60806040')
    reads.balanceOf = 8_000_000n
    reads.allowance = 8_000_000n
    // Made 1000s before the mocked block time: aged past the minimum, not yet expired.
    reads.commitmentAt = 999_000n
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'mybot.eth', setPrimary: false })
    expect(result).toContain('mybot.eth now resolves to')
    expect(writes()).toEqual(['register', 'setAddress', 'setAddress'])
  })

  it('register_ens rejects a name owned by someone else', async () => {
    reads.isAvailable = false
    reads.getOwner = '0x0000000000000000000000000000000000000001'
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'taken' })
    expect(result).toContain('Error')
    expect(result).toContain('already registered')
    expect(writeContract).not.toHaveBeenCalled()
  })

  it('register_ens finishes setup for a name the agent already registered', async () => {
    reads.isAvailable = false
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'mybot' })
    expect(result).toContain('mybot.eth now resolves to')
    expect(writes()).toEqual(['setAddress', 'setAddress', 'setName'])
  })

  it('register_ens reports completed steps when a later one fails', async () => {
    reads.isAvailable = false
    writeContract.mockResolvedValueOnce('0xabc123').mockRejectedValueOnce(new Error('rpc down'))
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'mybot' })
    expect(result).toContain('Error: rpc down')
    expect(result).toContain('Set address record')
    expect(result).toContain('again with the same name')
  })

  it('register_ens rejects subnames', async () => {
    const { registerEnsTool } = await import('../tools/ens.tool.js')
    const result = await registerEnsTool.invoke({ name: 'sub.mybot.eth' })
    expect(result).toContain('Error')
    expect(readContract).not.toHaveBeenCalled()
  })
})

describe('ens-name skill', () => {
  it('has name, description, and context fields', async () => {
    const { ensNameSkill } = await import('../skills/ens-name.skill.js')
    expect(ensNameSkill.name).toBe('ens-name')
    expect(ensNameSkill.description).toBeTruthy()
    expect(ensNameSkill.context).toContain('set_primary_ens')
    expect(ensNameSkill.context).toContain('register_ens')
  })
})

describe('EnsNameAction factory', () => {
  it('returns object with tools and skill', async () => {
    const { EnsNameAction } = await import('../index.js')
    const action = EnsNameAction()
    expect(action.name).toBe('ens-name')
    expect(action.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['resolve_ens', 'lookup_ens', 'register_ens', 'set_primary_ens']),
    )
    expect(action.skill.name).toBe('ens-name')
  })
})
