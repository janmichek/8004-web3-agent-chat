import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createReactAgent: vi.fn(),
  getLLM: vi.fn(),
  resolveAgentSkills: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@langchain/langgraph/prebuilt', () => ({ createReactAgent: mocks.createReactAgent }))
vi.mock('../llm.js', () => ({ getLLM: mocks.getLLM }))
vi.mock('../agent-skills.js', () => ({ resolveAgentSkills: mocks.resolveAgentSkills }))

import { runAgent } from '../orchestrator.js'

const msg = (content: unknown, type = 'ai') => ({ content, _getType: () => type })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  mocks.getLLM.mockReturnValue('llm')
  mocks.createReactAgent.mockReturnValue({ invoke: mocks.invoke })
  mocks.resolveAgentSkills.mockResolvedValue([])
})

describe('runAgent', () => {
  it('runs the task with no tools when no agent name is given', async () => {
    mocks.invoke.mockResolvedValue({ messages: [msg('hi', 'human'), msg('done')] })
    const result = await runAgent({ task: 'say hi', privateKey: '0xk' })
    expect(mocks.resolveAgentSkills).not.toHaveBeenCalled()
    expect(mocks.getLLM).toHaveBeenCalledWith({ streaming: false })
    expect(mocks.createReactAgent).toHaveBeenCalledWith({ llm: 'llm', tools: [] })
    expect(mocks.invoke).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'say hi' }] })
    expect(result).toEqual({ output: 'done', steps: ['[human] hi', '[ai] done'] })
  })

  it('loads the named agent skills with its private key and forwards streaming', async () => {
    const tool = { name: 'send_eth' }
    mocks.resolveAgentSkills.mockResolvedValue([tool])
    mocks.invoke.mockResolvedValue({ messages: [msg('ok')] })
    await runAgent({ task: 't', privateKey: '0xk', agentName: 'bot', streaming: true })
    expect(mocks.resolveAgentSkills).toHaveBeenCalledWith('bot', '0xk')
    expect(mocks.getLLM).toHaveBeenCalledWith({ streaming: true })
    expect(mocks.createReactAgent).toHaveBeenCalledWith({ llm: 'llm', tools: [tool] })
  })

  it('stringifies structured content and truncates each step to 200 chars', async () => {
    mocks.invoke.mockResolvedValue({
      messages: [msg('x'.repeat(500)), { content: [{ type: 'text', text: 'hello' }] }],
    })
    const result = await runAgent({ task: 't', privateKey: '0xk' })
    expect(result.output).toBe('[{"type":"text","text":"hello"}]')
    expect(result.steps[0]).toBe(`[ai] ${'x'.repeat(200)}`)
    expect(result.steps[1]).toMatch(/^\[unknown\] \[\{/)
  })

  it('propagates agent failures', async () => {
    mocks.invoke.mockRejectedValue(new Error('llm down'))
    await expect(runAgent({ task: 't', privateKey: '0xk' })).rejects.toThrow('llm down')
  })
})
