// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sampleAbi = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'address', name: 'spender' },
      { type: 'uint256', name: 'amount' },
    ],
    outputs: [{ type: 'bool', name: '' }],
  },
] as const

vi.mock('viem', async () => ({
  ...(await vi.importActual<typeof import('viem')>('viem')),
  createPublicClient: vi.fn(() => ({
    readContract: vi.fn(async () => BigInt('1000000000000000000')),
  })),
  createWalletClient: vi.fn(() => ({
    writeContract: vi.fn(async () => '0xdeadbeef'),
  })),
  http: vi.fn(),
  defineChain: vi.fn((chain: unknown) => chain),
  formatUnits: vi.fn(() => '1.0'),
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
  })),
}))

vi.mock('../../core/config.js', () => ({
  getRpcUrl: () => 'http://localhost:8545',
  getChainId: () => 42161,
}))

describe('contractCallSkill', () => {
  it('guides ABI discovery before calls', async () => {
    const { contractCallSkill } = await import('../skills/contract-call.skill.js')
    expect(contractCallSkill.name).toBe('contract-call')
    expect(contractCallSkill.description).toBeTruthy()
    expect(contractCallSkill.context).toContain('fetch_contract_abi')
    expect(contractCallSkill.context).toContain('call_contract')
  })
})

describe('ContractCallAction factory', () => {
  it('returns object with both tools and skill', async () => {
    const { ContractCallAction } = await import('../index.js')
    const action = ContractCallAction()
    expect(action.name).toBe('contract-call')
    expect(action.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fetch_contract_abi', 'call_contract']),
    )
    expect(action.skill.name).toBe('contract-call')
  })
})

describe('contract-call action registry', () => {
  it('is selectable and exposes the same tools', async () => {
    const { getActionByName } = await import('../../core/action-registry.js')
    const entry = getActionByName('contract-call')
    expect(entry).toBeDefined()
    expect(entry?.toolNames).toEqual(['fetch_contract_abi', 'call_contract'])
    expect(entry?.factory().skill.name).toBe('contract-call')
  })
})

describe('fetch_contract_abi tool', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ status: '1', result: JSON.stringify(sampleAbi) }),
      })),
    )
  })

  it('lists callable functions from a verified ABI', async () => {
    const { fetchContractAbiTool } = await import('../tools/fetch-contract-abi.tool.js')
    const result = await fetchContractAbiTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
    })
    expect(result).toContain('totalSupply')
    expect(result).toContain('approve')
    expect(result).toContain('2 functions')
  })

  it('returns an error string when the explorer rejects the ABI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ status: '0', result: 'Contract source code not verified' }),
      })),
    )
    const { fetchContractAbiTool } = await import('../tools/fetch-contract-abi.tool.js')
    const result = await fetchContractAbiTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
    })
    expect(result).toContain('Error')
    expect(result).toContain('not verified')
  })
})

describe('call_contract tool', () => {
  beforeEach(() => {
    vi.stubEnv(
      'AGENT_PRIVATE_KEY',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )
    vi.stubEnv('RPC_URL', 'http://localhost:8545')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ status: '1', result: JSON.stringify(sampleAbi) }),
      })),
    )
  })

  it('executes a view call and returns a formatted result', async () => {
    const { callContractTool } = await import('../tools/call-contract.tool.js')
    const result = await callContractTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
      functionName: 'totalSupply',
    })
    expect(typeof result).toBe('string')
    expect(result).not.toMatch(/^Error/)
    expect(result).toContain('raw')
  })

  it('returns an error when the function is missing from the ABI', async () => {
    const { callContractTool } = await import('../tools/call-contract.tool.js')
    const result = await callContractTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
      functionName: 'doesNotExist',
    })
    expect(result).toContain('Error')
    expect(result).toContain('doesNotExist')
  })

  it('returns an error when arg count mismatches the ABI', async () => {
    const { callContractTool } = await import('../tools/call-contract.tool.js')
    const result = await callContractTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
      functionName: 'approve',
      args: '["0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21"]',
    })
    expect(result).toContain('Error')
    expect(result).toContain('expects 2 args')
  })

  it('executes a write call and returns the tx hash', async () => {
    const { callContractTool } = await import('../tools/call-contract.tool.js')
    const result = await callContractTool.invoke({
      address: '0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21',
      functionName: 'approve',
      args: '["0x742d35Cc6634C0532925a3b8D4C9C4A3b5C09d21", "100"]',
    })
    expect(result).toBe('0xdeadbeef')
  })
})
