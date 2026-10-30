import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rep = vi.hoisted(() => ({ giveFeedback: vi.fn(), getReputationSummary: vi.fn() }))
vi.mock('../../core/reputation.js', () => rep)

import { getReputationTool, giveFeedbackTool } from '../tools/feedback.tool.js'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('RATER_PRIVATE_KEY', '')
  vi.stubEnv('AGENT_PRIVATE_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())

const input = { agentId: '421614:204', value: 90, tag: 'transfer', comment: 'fast' }

describe('give_feedback', () => {
  it('errors without any signing key', async () => {
    expect(await giveFeedbackTool.invoke(input)).toMatch(/RATER_PRIVATE_KEY .* is not set/)
    expect(rep.giveFeedback).not.toHaveBeenCalled()
  })

  it('prefers RATER_PRIVATE_KEY over AGENT_PRIVATE_KEY', async () => {
    vi.stubEnv('RATER_PRIVATE_KEY', '0xrater')
    vi.stubEnv('AGENT_PRIVATE_KEY', '0xagent')
    rep.giveFeedback.mockResolvedValue({ txHash: '0xtx' })
    expect(await giveFeedbackTool.invoke(input)).toBe('0xtx')
    expect(rep.giveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: '0xrater' }),
    )
  })

  it('falls back to AGENT_PRIVATE_KEY and reports the feedback uri', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '0xagent')
    rep.giveFeedback.mockResolvedValue({ txHash: '0xtx', feedbackURI: 'ipfs://cid' })
    expect(await giveFeedbackTool.invoke(input)).toBe('0xtx (feedback: ipfs://cid)')
    expect(rep.giveFeedback).toHaveBeenCalledWith({
      agentId: '421614:204',
      value: 90,
      tag: 'transfer',
      endpoint: undefined,
      comment: 'fast',
      privateKey: '0xagent',
    })
  })

  it('never throws; truncates long errors to 300 chars', async () => {
    vi.stubEnv('RATER_PRIVATE_KEY', '0xrater')
    rep.giveFeedback.mockRejectedValue(new Error('e'.repeat(500)))
    const out = (await giveFeedbackTool.invoke(input)) as string
    expect(out).toBe(`Error: ${'e'.repeat(300)}...`)
  })

  it('stringifies non-Error rejections', async () => {
    vi.stubEnv('RATER_PRIVATE_KEY', '0xrater')
    rep.giveFeedback.mockRejectedValue('plain')
    expect(await giveFeedbackTool.invoke(input)).toBe('Error: plain')
  })
})

describe('get_reputation', () => {
  it('returns the summary as JSON', async () => {
    rep.getReputationSummary.mockResolvedValue({ count: 2, average: 80 })
    expect(await getReputationTool.invoke({ agentId: '1:2', tag: 'x' })).toBe(
      '{"count":2,"average":80}',
    )
    expect(rep.getReputationSummary).toHaveBeenCalledWith('1:2', 'x')
  })

  it('returns an error string on failure', async () => {
    rep.getReputationSummary.mockRejectedValue(new Error('rpc down'))
    expect(await getReputationTool.invoke({ agentId: '1:2' })).toBe('Error: rpc down')
  })
})
