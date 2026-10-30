import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  extractSuccessfulTxHash,
  scanUrlForAgent,
  txScanUrl,
  saveAgentBackup,
  loadAgentBackup,
  deleteAgentBackup,
  sortAgentsByLastUsed,
} from './api'

const BACKUP_KEY = 'web3agent:backups:v1'

const setItem = vi.fn<(key: string, value: string) => void>()

beforeEach(() => {
  setItem.mockReset()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem,
    removeItem: vi.fn(),
    clear: vi.fn(),
  } as unknown as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractSuccessfulTxHash', () => {
  it('returns null for error content', () => {
    expect(extractSuccessfulTxHash('Error: something failed')).toBeNull()
    expect(extractSuccessfulTxHash('Error: tx failed\n0xdeadbeef')).toBeNull()
  })

  it('extracts a 64-hex tx hash from non-error content', () => {
    expect(
      extractSuccessfulTxHash(
        'Sent 0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234abcd',
      ),
    ).toBe('0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234abcd')
  })

  it('returns null when there is no hash', () => {
    expect(extractSuccessfulTxHash('All done, no tx here')).toBeNull()
    expect(extractSuccessfulTxHash('0xshort')).toBeNull()
  })
})

describe('scanUrlForAgent', () => {
  it('builds a testnet 8004scan URL for a prefixed agent id', () => {
    expect(scanUrlForAgent('421614:7', 421614)).toBe(
      'https://testnet.8004scan.io/agents/arbitrum-sepolia/7',
    )
  })

  it('uses the chainId argument for bare token ids', () => {
    expect(scanUrlForAgent('7', 11155111)).toBe('https://testnet.8004scan.io/agents/sepolia/7')
  })

  it('appends a tab when provided', () => {
    expect(scanUrlForAgent('421614:7', 421614, 'services')).toBe(
      'https://testnet.8004scan.io/agents/arbitrum-sepolia/7?tab=services',
    )
  })
})

describe('txScanUrl', () => {
  it('builds an explorer tx URL', () => {
    expect(txScanUrl('0xabc123', 421614)).toBe('https://sepolia.arbiscan.io/tx/0xabc123')
    expect(txScanUrl('0xabc123', 11155111)).toBe('https://sepolia.etherscan.io/tx/0xabc123')
  })
})

describe('agent backups (localStorage)', () => {
  it('save then load round-trips', () => {
    saveAgentBackup('my-agent', { foo: 'bar' }, '0xprivatekey')
    const item = setItem.mock.calls.find(([k]) => k === BACKUP_KEY)
    expect(item).toBeDefined()
    const payload = JSON.parse(item![1])
    expect(payload['my-agent'].config).toEqual({ foo: 'bar' })
    expect(payload['my-agent'].privateKey).toBe('0xprivatekey')
    expect(payload['my-agent'].savedAt).toBeTruthy()
  })

  it('load returns null when nothing stored', () => {
    expect(loadAgentBackup('nope')).toBeNull()
  })

  it('delete removes the entry', () => {
    saveAgentBackup('x', {}, '0xk')
    deleteAgentBackup('x')
    // deleteAgentBackup re-writes the whole map via setItem (not removeItem).
    // The last setItem call is from deleteAgentBackup.
    const calls = setItem.mock.calls.filter(([k]) => k === BACKUP_KEY)
    const last = calls[calls.length - 1]
    expect(last).toBeDefined()
    const payload = JSON.parse(last[1])
    expect(payload).not.toHaveProperty('x')
  })
})

describe('sortAgentsByLastUsed (re-exported)', () => {
  it('sorts by lastActive descending', () => {
    const agents = [
      { name: 'a', lastActive: '2024-01-01T00:00:00.000Z' },
      { name: 'b', lastActive: '2025-01-01T00:00:00.000Z' },
    ]
    expect(sortAgentsByLastUsed(agents).map((x) => x.name)).toEqual(['b', 'a'])
  })
})
