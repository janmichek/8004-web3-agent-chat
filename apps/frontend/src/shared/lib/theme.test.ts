import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initTheme, theme, toggleTheme } from './theme'

const store = new Map<string, string>()
const dataset: Record<string, string> = {}
let prefersLight = false

beforeEach(() => {
  theme.value = 'dark'
  store.clear()
  for (const k of Object.keys(dataset)) delete dataset[k]
  prefersLight = false
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: prefersLight }) })
})

afterEach(() => vi.unstubAllGlobals())

describe('initTheme', () => {
  it('defaults to dark when nothing is stored and the OS prefers dark', () => {
    initTheme()
    expect(theme.value).toBe('dark')
    expect(dataset.theme).toBe('dark')
  })

  it('follows prefers-color-scheme: light when nothing is stored', () => {
    prefersLight = true
    initTheme()
    expect(theme.value).toBe('light')
  })

  it('prefers the stored value over the OS setting', () => {
    prefersLight = true
    store.set('theme', 'dark')
    initTheme()
    expect(theme.value).toBe('dark')
  })

  it('ignores a corrupt stored value', () => {
    store.set('theme', 'purple')
    initTheme()
    expect(theme.value).toBe('dark')
  })

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => initTheme()).not.toThrow()
    expect(theme.value).toBe('dark')
  })
})

describe('toggleTheme', () => {
  it('flips the theme, applies it and persists it', () => {
    initTheme()
    toggleTheme()
    expect(theme.value).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(store.get('theme')).toBe('light')
    toggleTheme()
    expect(theme.value).toBe('dark')
  })

  it('still applies the theme when storage throws on write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => toggleTheme()).not.toThrow()
    expect(theme.value).toBe('light')
  })
})
