import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { OASF_VERSION } from '../oasf.js'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        '1': { id: 1, name: 'Language Processing', caption: 'Language Processing' },
        '2': { id: 2, name: 'Software Engineering', caption: 'Software Engineering' },
      }),
    })),
  )
  // Reset the module-level cache between tests
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OASF_VERSION', () => {
  it('is pinned to 1.1.0', () => {
    expect(OASF_VERSION).toBe('1.1.0')
  })
})

describe('fetchOasfDomainSlugs', () => {
  it('fetches and caches the id→slug map', async () => {
    // Re-import to get fresh cache state
    const mod = await import('../oasf.js')
    const slugs = await mod.fetchOasfDomainSlugs()
    expect(slugs['1']).toBe('Language Processing')
    expect(slugs['2']).toBe('Software Engineering')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the cache on a second call', async () => {
    const mod = await import('../oasf.js')
    await mod.fetchOasfDomainSlugs()
    await mod.fetchOasfDomainSlugs()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws when the taxonomy server fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502 } as Response)
    const mod = await import('../oasf.js')
    await expect(mod.fetchOasfDomainSlugs()).rejects.toThrow(/OASF taxonomy fetch failed \(502\)/)
  })
})

describe('oasfDomainSlugs', () => {
  it('translates known numeric ids to slugs and passes unknown through', async () => {
    const mod = await import('../oasf.js')
    const result = await mod.oasfDomainSlugs(['1', '2', '999'])
    expect(result).toEqual(['Language Processing', 'Software Engineering', '999'])
  })

  it('returns ids unchanged when the fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))
    const mod = await import('../oasf.js')
    const result = await mod.oasfDomainSlugs(['1', '2'])
    expect(result).toEqual(['1', '2'])
  })
})

describe('buildOasfService', () => {
  it('builds the oasf service entry with translated domains', async () => {
    const mod = await import('../oasf.js')
    const service = await mod.buildOasfService(
      ['1', '2'],
      ['101', '301'],
      'https://example.com/oasf',
    )
    expect(service).toEqual({
      name: 'oasf',
      endpoint: 'https://example.com/oasf',
      version: '1.1.0',
      skills: ['101', '301'],
      domains: ['Language Processing', 'Software Engineering'],
    })
  })

  it('passes domains through unchanged on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const mod = await import('../oasf.js')
    const service = await mod.buildOasfService(['1', '2'], [], 'https://example.com/oasf')
    expect(service.domains).toEqual(['1', '2'])
  })
})
