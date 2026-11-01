import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shortAddr, shortTx, timeAgo } from './format'

const NOW = new Date('2026-01-15T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('timeAgo', () => {
  it('renders a dash without a timestamp', () => {
    expect(timeAgo(null)).toBe('—')
  })

  it('uses coarse buckets from just now to days', () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
    expect(timeAgo(ago(10_000))).toBe('just now')
    expect(timeAgo(ago(5 * 60_000))).toBe('5m ago')
    expect(timeAgo(ago(3 * 3_600_000))).toBe('3h ago')
    expect(timeAgo(ago(4 * 86_400_000))).toBe('4d ago')
  })

  it('falls back to a locale date after a week', () => {
    const old = new Date(NOW.getTime() - 8 * 86_400_000)
    expect(timeAgo(old.toISOString())).toBe(old.toLocaleDateString())
  })
})

describe('shortAddr', () => {
  it('keeps the first 6 and last 4 characters', () => {
    expect(shortAddr('0x1234567890abcdef')).toBe('0x1234…cdef')
  })

  it('leaves short values alone', () => {
    expect(shortAddr('0x1234')).toBe('0x1234')
  })
})

describe('shortTx', () => {
  it('keeps the first 10 and last 6 characters', () => {
    expect(shortTx('0x1234567890abcdef1234')).toBe('0x12345678…ef1234')
  })
})
