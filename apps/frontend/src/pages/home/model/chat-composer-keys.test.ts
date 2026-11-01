import { describe, expect, it } from 'vitest'
import { isSubmitKey } from './chat-composer-keys'

const key = (over: Partial<{ key: string; shiftKey: boolean; isComposing: boolean }> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  isComposing: false,
  ...over,
})

describe('isSubmitKey', () => {
  it('submits on plain Enter', () => {
    expect(isSubmitKey(key())).toBe(true)
  })

  it('keeps Shift+Enter for a newline', () => {
    expect(isSubmitKey(key({ shiftKey: true }))).toBe(false)
  })

  it('ignores Enter while an IME composition is active', () => {
    expect(isSubmitKey(key({ isComposing: true }))).toBe(false)
  })

  it('ignores other keys', () => {
    expect(isSubmitKey(key({ key: 'a' }))).toBe(false)
  })
})
