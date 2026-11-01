import { afterEach, describe, expect, it, vi } from 'vitest'

import { e2eConnectedAddress, e2eSendTx } from './e2e'

afterEach(() => vi.unstubAllGlobals())

describe('e2eConnectedAddress', () => {
  it('is undefined without a window or forced address', () => {
    expect(e2eConnectedAddress()).toBeUndefined()
    vi.stubGlobal('window', {})
    expect(e2eConnectedAddress()).toBeUndefined()
  })

  it('returns a valid forced address', () => {
    vi.stubGlobal('window', {
      __E2E_CONNECTED_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
    })
    expect(e2eConnectedAddress()).toBe('0x1234567890abcdef1234567890abcdef12345678')
  })

  it('ignores an invalid forced address', () => {
    vi.stubGlobal('window', { __E2E_CONNECTED_ADDRESS: 'not-an-address' })
    expect(e2eConnectedAddress()).toBeUndefined()
  })
})

describe('e2eSendTx', () => {
  it('is undefined without a stub', () => {
    vi.stubGlobal('window', {})
    expect(e2eSendTx()).toBeUndefined()
  })

  it('returns the Playwright send stub', () => {
    const stub = () => '0xhash'
    vi.stubGlobal('window', { __E2E_SEND_TX: stub })
    expect(e2eSendTx()).toBe(stub)
  })
})
