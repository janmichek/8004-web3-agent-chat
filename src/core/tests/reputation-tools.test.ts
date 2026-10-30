import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.stubEnv(
    'RATER_PRIVATE_KEY',
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  )
  vi.stubEnv(
    'AGENT_PRIVATE_KEY',
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveRaterPrivateKey', () => {
  it('uses the override when provided', async () => {
    const mod = await import('../reputation.js')
    expect(mod.resolveRaterPrivateKey('0xoverride')).toBe('0xoverride')
  })

  it('falls back to RATER_PRIVATE_KEY', async () => {
    const mod = await import('../reputation.js')
    expect(mod.resolveRaterPrivateKey(undefined)).toBe(process.env.RATER_PRIVATE_KEY)
  })

  it('falls back to AGENT_PRIVATE_KEY', async () => {
    vi.stubEnv('RATER_PRIVATE_KEY', '')
    const mod = await import('../reputation.js')
    expect(mod.resolveRaterPrivateKey(undefined)).toBe(process.env.AGENT_PRIVATE_KEY)
  })

  it('throws when no key is available', async () => {
    vi.stubEnv('RATER_PRIVATE_KEY', '')
    vi.stubEnv('AGENT_PRIVATE_KEY', '')
    const mod = await import('../reputation.js')
    expect(() => mod.resolveRaterPrivateKey()).toThrow(/RATER_PRIVATE_KEY is not set/)
  })
})

describe('deriveTag2', () => {
  it('uses tag when provided and not "starred"', async () => {
    const { deriveTag2 } = await import('../reputation.js')
    expect(deriveTag2('transfer', 'paid for gas', false)).toBe('transfer')
  })

  it('falls back to comment when tag is "starred" and no IPFS', async () => {
    const { deriveTag2 } = await import('../reputation.js')
    expect(deriveTag2('starred', 'great agent', false)).toBe('great agent')
  })

  it('omits tag2 when the comment goes to IPFS', async () => {
    const { deriveTag2 } = await import('../reputation.js')
    expect(deriveTag2('starred', 'great agent', true)).toBeUndefined()
  })

  it('omits tag2 when nothing applies', async () => {
    const { deriveTag2 } = await import('../reputation.js')
    expect(deriveTag2('starred', undefined, false)).toBeUndefined()
  })

  it('truncates tag2 to 32 chars', async () => {
    const { deriveTag2 } = await import('../reputation.js')
    expect(deriveTag2('a'.repeat(50), undefined, false)).toBe('a'.repeat(32))
  })
})
