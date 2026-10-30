import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ctor = vi.hoisted(() => ({ anthropic: vi.fn(), openai: vi.fn(), openrouter: vi.fn() }))

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    kind = 'anthropic'
    constructor(args: unknown) {
      ctor.anthropic(args)
    }
  },
}))
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    kind = 'openai'
    constructor(args: unknown) {
      ctor.openai(args)
    }
  },
}))
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    constructor(args: unknown) {
      ctor.openrouter(args)
    }
  },
}))

import { getLLM } from '../llm.js'

beforeEach(() => {
  vi.resetAllMocks()
  for (const k of [
    'LLM_PROVIDER',
    'LLM_MODEL',
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ]) {
    vi.stubEnv(k, '')
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('getLLM', () => {
  it('defaults to openrouter and requires its key', () => {
    expect(() => getLLM()).toThrow(/OPENROUTER_API_KEY is not set/)
  })

  it('builds an openrouter model with the key and default model', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    const llm = getLLM()
    expect(llm._llmType()).toBe('openrouter')
    expect(ctor.openrouter).toHaveBeenCalledWith({ apiKey: 'or-key' })
  })

  it('builds an anthropic model with streaming and model override', () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'a-key')
    vi.stubEnv('LLM_MODEL', 'claude-test')
    getLLM({ streaming: true })
    expect(ctor.anthropic).toHaveBeenCalledWith({
      modelName: 'claude-test',
      anthropicApiKey: 'a-key',
      streaming: true,
    })
  })

  it('uses the provider default model when LLM_MODEL is unset', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'o-key')
    getLLM()
    expect(ctor.openai).toHaveBeenCalledWith({
      modelName: 'gpt-4o',
      openAIApiKey: 'o-key',
      streaming: false,
    })
  })

  it.each([
    ['anthropic', /ANTHROPIC_API_KEY is not set/],
    ['openai', /OPENAI_API_KEY is not set/],
  ])('requires a key for %s', (provider, message) => {
    vi.stubEnv('LLM_PROVIDER', provider)
    expect(() => getLLM()).toThrow(message)
  })

  it('rejects unknown providers', () => {
    vi.stubEnv('LLM_PROVIDER', 'mystery')
    expect(() => getLLM()).toThrow(/Unknown LLM_PROVIDER "mystery"/)
  })
})
