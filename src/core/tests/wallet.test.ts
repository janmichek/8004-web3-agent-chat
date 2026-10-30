import * as fs from 'node:fs'
import { ethers } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

const provider = vi.hoisted(() => ({ getBalance: vi.fn() }))
vi.mock('../config.js', () => ({ getProvider: () => provider }))

import {
  fundAgentWallet,
  getAgentWalletEnvVars,
  getMasterWallet,
  getMasterWalletBalance,
  getOrCreateAgentWallet,
} from '../wallet.js'

const KEY = '0x0000000000000000000000000000000000000000000000000000000000000001'
const KEY_ADDRESS = new ethers.Wallet(KEY).address

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fs.existsSync).mockReturnValue(false)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('AGENT_PRIVATE_KEY', '')
  vi.stubEnv('AGENT_MY_BOT_PRIVATE_KEY', '')
  vi.stubEnv('MASTER_PRIVATE_KEY', '')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getAgentWalletEnvVars', () => {
  it('derives the per-agent var from the name, then the generic one', () => {
    expect(getAgentWalletEnvVars('my-bot')).toEqual([
      'AGENT_MY_BOT_PRIVATE_KEY',
      'AGENT_PRIVATE_KEY',
    ])
  })
})

describe('getOrCreateAgentWallet', () => {
  it('prefers the per-agent env var over everything else', () => {
    vi.stubEnv('AGENT_MY_BOT_PRIVATE_KEY', KEY)
    expect(getOrCreateAgentWallet({ agentName: 'my-bot' })).toEqual({
      address: KEY_ADDRESS,
      privateKey: KEY,
    })
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('falls through an invalid env key to the generic one', () => {
    vi.stubEnv('AGENT_MY_BOT_PRIVATE_KEY', 'not-a-key')
    vi.stubEnv('AGENT_PRIVATE_KEY', KEY)
    expect(getOrCreateAgentWallet({ agentName: 'my-bot' }).address).toBe(KEY_ADDRESS)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid private key'))
  })

  it('loads an existing wallet.json', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ address: '0xabc', privateKey: '0xdef' }),
    )
    expect(getOrCreateAgentWallet({ agentName: 'my-bot' })).toEqual({
      address: '0xabc',
      privateKey: '0xdef',
    })
  })

  it('generates and persists a fresh wallet when the file is corrupt', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('{broken')
    const w = getOrCreateAgentWallet({ agentName: 'my-bot' })
    expect(ethers.isAddress(w.address)).toBe(true)
    expect(new ethers.Wallet(w.privateKey).address).toBe(w.address)
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('my-bot'), {
      recursive: true,
    })
    const [file, body] = vi.mocked(fs.writeFileSync).mock.calls[0]!
    expect(String(file)).toMatch(/my-bot\/wallet\.json$/)
    expect(JSON.parse(body as string)).toEqual(w)
  })

  it('still returns the wallet when persisting fails', () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EROFS')
    })
    const w = getOrCreateAgentWallet({ agentName: 'my-bot' })
    expect(ethers.isAddress(w.address)).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist'),
      expect.any(Error),
    )
  })
})

describe('master wallet', () => {
  it('throws without MASTER_PRIVATE_KEY', () => {
    expect(() => getMasterWallet()).toThrow(/MASTER_PRIVATE_KEY is not set/)
  })

  it('connects the master wallet to the active provider', () => {
    vi.stubEnv('MASTER_PRIVATE_KEY', KEY)
    const w = getMasterWallet()
    expect(w.address).toBe(KEY_ADDRESS)
    expect(w.provider).toBe(provider)
  })

  it('reports the balance in ether', async () => {
    vi.stubEnv('MASTER_PRIVATE_KEY', KEY)
    provider.getBalance.mockResolvedValue(ethers.parseEther('1.5'))
    expect(await getMasterWalletBalance()).toBe('1.5')
    expect(provider.getBalance).toHaveBeenCalledWith(KEY_ADDRESS)
  })

  it('funds an agent with the default or given amount', async () => {
    vi.stubEnv('MASTER_PRIVATE_KEY', KEY)
    const wait = vi.fn().mockResolvedValue(undefined)
    const send = vi
      .spyOn(ethers.Wallet.prototype, 'sendTransaction')
      .mockResolvedValue({ hash: '0xhash', wait } as never)
    expect(await fundAgentWallet({ agentAddress: '0xAgent' })).toBe('0xhash')
    expect(send).toHaveBeenLastCalledWith({ to: '0xAgent', value: ethers.parseEther('0.001') })
    await fundAgentWallet({ agentAddress: '0xAgent', amountEth: '0.5' })
    expect(send).toHaveBeenLastCalledWith({ to: '0xAgent', value: ethers.parseEther('0.5') })
    expect(wait).toHaveBeenCalledTimes(2)
  })
})
