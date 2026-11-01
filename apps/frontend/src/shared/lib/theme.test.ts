import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cycleTheme, initTheme, setThemePreference, theme, themePreference } from './theme'

const store = new Map<string, string>()
const dataset: Record<string, string> = {}
let prefersLight = false
let systemListener: (() => void) | null = null

beforeEach(() => {
  theme.value = 'dark'
  themePreference.value = 'auto'
  store.clear()
  for (const k of Object.keys(dataset)) delete dataset[k]
  prefersLight = false
  systemListener = null
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: prefersLight,
      addEventListener: (_: string, fn: () => void) => {
        systemListener = fn
      },
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('initTheme', () => {
  it('defaults to auto and follows a dark OS preference', () => {
    initTheme()
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('dark')
    expect(dataset.theme).toBe('dark')
  })

  it('follows prefers-color-scheme: light when nothing is stored', () => {
    prefersLight = true
    initTheme()
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('light')
  })

  it('prefers the stored value over the OS setting', () => {
    prefersLight = true
    store.set('theme', 'dark')
    initTheme()
    expect(themePreference.value).toBe('dark')
    expect(theme.value).toBe('dark')
  })

  it('restores a stored auto preference', () => {
    prefersLight = true
    store.set('theme', 'auto')
    initTheme()
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('light')
  })

  it('ignores a corrupt stored value', () => {
    store.set('theme', 'purple')
    initTheme()
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('dark')
  })

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => initTheme()).not.toThrow()
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('dark')
  })

  it('tracks OS changes while the preference is auto', () => {
    initTheme()
    prefersLight = true
    systemListener?.()
    expect(theme.value).toBe('light')
  })

  it('ignores OS changes when the preference is explicit', () => {
    initTheme()
    setThemePreference('dark')
    prefersLight = true
    systemListener?.()
    expect(theme.value).toBe('dark')
  })
})

describe('setThemePreference', () => {
  it('applies and persists an explicit preference', () => {
    initTheme()
    setThemePreference('light')
    expect(theme.value).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(store.get('theme')).toBe('light')
  })

  it('applies the OS preference when set to auto', () => {
    prefersLight = true
    setThemePreference('auto')
    expect(themePreference.value).toBe('auto')
    expect(theme.value).toBe('light')
    expect(store.get('theme')).toBe('auto')
  })

  it('still applies the theme when storage throws on write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => setThemePreference('light')).not.toThrow()
    expect(theme.value).toBe('light')
  })
})

describe('cycleTheme', () => {
  it('cycles auto to light to dark and back to auto', () => {
    initTheme()
    expect(themePreference.value).toBe('auto')
    cycleTheme()
    expect(themePreference.value).toBe('light')
    expect(theme.value).toBe('light')
    cycleTheme()
    expect(themePreference.value).toBe('dark')
    expect(theme.value).toBe('dark')
    cycleTheme()
    expect(themePreference.value).toBe('auto')
    expect(store.get('theme')).toBe('auto')
  })
})
