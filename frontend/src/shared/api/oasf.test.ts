import { describe, expect, it, vi } from 'vitest'
import { fetchOasfDomains } from './oasf'

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      '6': {
        id: 6,
        name: 'Software Engineering',
        caption: 'Software Engineering',
        classes: {
          '602': { id: 602, name: 'Web Development', caption: 'Web Development' },
          '603': { id: 603, name: 'DevOps', caption: 'DevOps' },
        },
      },
      '10': {
        id: 10,
        name: 'Data Science',
        caption: 'Data Science',
        classes: {
          '1001': { id: 1001, name: 'Machine Learning', caption: 'Machine Learning' },
        },
      },
    }),
  })),
)

describe('fetchOasfDomains', () => {
  it('transforms the taxonomy into domains with sorted skills', async () => {
    const domains = await fetchOasfDomains()
    expect(domains.length).toBe(2)
    expect(domains[0].id).toBe('6')
    expect(domains[0].name).toBe('Software Engineering')
    expect(domains[0].slug).toBe('Software Engineering')
    expect(domains[0].skills.map((s) => s.id)).toEqual(['602', '603'])
    expect(domains[0].skills[0].name).toBe('Web Development')
    expect(domains[0].skills[0].slug).toBe('Web Development')

    expect(domains[1].id).toBe('10')
    expect(domains[1].skills[0].id).toBe('1001')
  })

  it('falls back to id when name/caption is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        '99': { id: 99, classes: { '1': { id: 1 } } },
      }),
    } as any)
    const domains = await fetchOasfDomains()
    expect(domains[0].id).toBe('99')
    expect(domains[0].name).toBe('99')
    expect(domains[0].slug).toBe('99')
    expect(domains[0].skills[0].id).toBe('1')
    expect(domains[0].skills[0].name).toBe('1')
  })

  it('throws when the fetch fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    await expect(fetchOasfDomains()).rejects.toThrow(/OASF taxonomy fetch failed \(500\)/)
  })
})
