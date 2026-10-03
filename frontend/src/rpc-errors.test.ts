import { describe, expect, it } from 'vitest'
import { friendlyFundError, isRpcRateLimit } from './rpc-errors'

describe('friendlyFundError', () => {
  it('maps RPC rate-limit wording', () => {
    expect(friendlyFundError(new Error('Request exceeds defined limit.'))).toBe(
      'RPC rate limit hit. Wait a few seconds and retry.',
    )
    expect(isRpcRateLimit(new Error('Request exceeds defined limit.'))).toBe(true)
  })

  it('maps user rejection and insufficient funds', () => {
    expect(friendlyFundError(new Error('User rejected the request.'))).toBe(
      'Wallet signature rejected.',
    )
    expect(friendlyFundError(new Error('insufficient funds for gas'))).toBe(
      'Wallet has insufficient ETH.',
    )
  })

  it('keeps the first line of unknown errors', () => {
    expect(friendlyFundError(new Error('boom\nstack'))).toBe('boom')
  })
})
