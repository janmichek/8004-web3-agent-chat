import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentSummary } from '@/shared/api'

const actions = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getBalance: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))
const api = vi.hoisted(() => ({ fundAgent: vi.fn() }))
const lib = vi.hoisted(() => ({
  ensureChain: vi.fn(),
  prepareNativeTransfer: vi.fn(),
  friendlyFundError: vi.fn(),
  e2eSendTx: vi.fn(() => undefined),
}))

vi.mock('@wagmi/vue', () => ({ useConfig: () => ({}) }))
vi.mock('@wagmi/vue/actions', () => actions)
vi.mock('@/shared/api', () => api)
vi.mock('@/shared/lib', () => lib)

import { isFundAmountValid, useAgentFunding } from './use-agent-funding'

const TX = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

function makeAgent(): AgentSummary {
  return {
    name: 'fresh-agent',
    description: '',
    walletAddress: '0x1111111111111111111111111111111111111111',
    walletChainId: 11155111,
    actions: [],
    tools: [],
    active: true,
  }
}

function setup() {
  const agent = ref(makeAgent())
  const balance = ref('0')
  return { agent, balance, ...useAgentFunding(agent, balance) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', {})
})

afterEach(() => vi.unstubAllGlobals())

describe('isFundAmountValid', () => {
  it('accepts a positive amount up to one ETH', () => {
    expect(isFundAmountValid('0.002')).toBe(true)
    expect(isFundAmountValid('1')).toBe(true)
  })

  it('rejects zero, negatives, junk and overspend', () => {
    expect(isFundAmountValid('0')).toBe(false)
    expect(isFundAmountValid('-1')).toBe(false)
    expect(isFundAmountValid('abc')).toBe(false)
    expect(isFundAmountValid('2')).toBe(false)
  })
})

describe('master funding', () => {
  it('credits the balance and settles the step', async () => {
    api.fundAgent.mockResolvedValue({ txHash: TX, amountEth: '0.001' })
    const funding = setup()

    await funding.fundFromMaster()

    expect(api.fundAgent).toHaveBeenCalledWith('fresh-agent', '0.002')
    expect(funding.funded.value).toBe(true)
    expect(funding.fundStatus.value).toContain('Confirmed')
    expect(funding.fundTxUrl.value).toContain('/tx/0xeeee')
    expect(funding.balance.value).toBe('0.001')
  })

  it('shows the friendly error and does not settle', async () => {
    api.fundAgent.mockRejectedValue(new Error('boom'))
    lib.friendlyFundError.mockReturnValue('Master wallet is empty.')
    const funding = setup()

    await funding.fundFromMaster()

    expect(funding.funded.value).toBe(false)
    expect(funding.fundStatusKind.value).toBe('error')
    expect(funding.fundStatus.value).toBe('Master wallet is empty.')
  })

  it('does nothing when the amount is invalid', async () => {
    const funding = setup()
    funding.fundEth.value = '0'

    await funding.fundFromMaster()

    expect(api.fundAgent).not.toHaveBeenCalled()
  })
})

describe('fund button label', () => {
  it('reads Fund wallet before any funding', () => {
    expect(setup().fundButtonLabel.value).toBe('Fund wallet')
  })

  it('mirrors the live step while a transfer is in flight', async () => {
    const funding = setup()
    let release!: (hash: string) => void
    api.fundAgent.mockReturnValue(new Promise((r) => (release = r)))

    const pending = funding.fundFromMaster()
    expect(funding.fundButtonLabel.value).toBe('Sending…')

    release({ txHash: TX, amountEth: '0.002' } as never)
    await pending
    expect(funding.fundButtonLabel.value).toBe('Add more')
  })

  it('falls back to Fund wallet after a failed attempt', async () => {
    api.fundAgent.mockRejectedValue(new Error('boom'))
    lib.friendlyFundError.mockReturnValue('Master wallet is empty.')
    const funding = setup()

    await funding.fundFromMaster()

    expect(funding.fundButtonLabel.value).toBe('Fund wallet')
  })
})

describe('wallet funding', () => {
  beforeEach(() => {
    actions.getAccount.mockReturnValue({ address: '0x2222222222222222222222222222222222222222' })
    actions.getBalance.mockResolvedValue({ value: 10n ** 18n })
    lib.prepareNativeTransfer.mockResolvedValue({
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    })
    actions.sendTransaction.mockResolvedValue(TX)
    actions.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
  })

  it('sends from the connected wallet and credits the balance', async () => {
    const funding = setup()

    await funding.fundFromWallet()

    expect(lib.ensureChain).toHaveBeenCalledWith({}, 11155111)
    expect(actions.sendTransaction).toHaveBeenCalled()
    expect(funding.funded.value).toBe(true)
    expect(funding.fundStatus.value).toContain('Confirmed')
    expect(funding.balance.value).toBe('0.002')
  })

  it('reports a reverted transaction', async () => {
    actions.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })
    lib.friendlyFundError.mockReturnValue('Funding transaction failed on-chain.')
    const funding = setup()

    await funding.fundFromWallet()

    expect(funding.funded.value).toBe(false)
    expect(funding.fundStatusKind.value).toBe('error')
    expect(funding.fundStatus.value).toBe('Funding transaction failed on-chain.')
  })

  it('refuses to send when there is not enough for gas', async () => {
    actions.getBalance.mockResolvedValue({ value: 1n })
    lib.friendlyFundError.mockReturnValue('not enough funds')
    const funding = setup()

    await funding.fundFromWallet()

    expect(actions.sendTransaction).not.toHaveBeenCalled()
    expect(funding.fundStatus.value).toBe('not enough funds')
  })
})
