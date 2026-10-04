import { describe, expect, it } from 'vitest'
import { errorLine, friendlyFundError, isRpcRateLimit } from './rpc-errors'

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
    expect(friendlyFundError(new Error('insufficient funds for gas'), 'master')).toContain(
      'Master wallet has insufficient ETH.',
    )
  })

  it('does not mistake a hash containing 429 for a rate limit', () => {
    expect(isRpcRateLimit(new Error('tx 0xab429cd reverted'))).toBe(false)
    expect(isRpcRateLimit(new Error('HTTP 429 Too Many Requests'))).toBe(true)
  })

  it('keeps the first line of unknown errors', () => {
    expect(friendlyFundError(new Error('boom\nstack'))).toBe('boom')
    expect(errorLine({}, 'Delete failed')).toBe('Delete failed')
  })
})
