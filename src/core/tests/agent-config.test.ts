import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dirs = vi.hoisted(() => ({ agents: '' }))
vi.mock('../wallet.js', () => ({
  get AGENTS_DIR() {
    return dirs.agents
  },
}))

import {
  buildCapabilitySummary,
  deleteAgentConfig,
  loadAgentConfig,
  parseAgentConfig,
  resolveToolsFromConfig,
  saveAgentConfig,
  type AgentConfig,
} from '../agent-config.js'

function config(overrides: Partial<AgentConfig['metadata']> = {}): AgentConfig {
  return {
    name: 'bot',
    description: 'a bot',
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: { actions: [], tools: [], ...overrides },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: 1,
  }
}

beforeAll(() => {
  dirs.agents = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-'))
})
afterAll(() => fs.rmSync(dirs.agents, { recursive: true, force: true }))
beforeEach(() => {
  vi.stubEnv('AGENT_BOT_CONFIG', '')
  vi.stubEnv('VERCEL', '')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(path.join(dirs.agents, 'bot'), { recursive: true, force: true })
})

const configFile = () => path.join(dirs.agents, 'bot', 'agent-config.json')

describe('save / load / delete', () => {
  it('round-trips a config through disk', () => {
    const cfg = config({ actions: ['transfer-eth'] })
    saveAgentConfig('bot', cfg)
    expect(JSON.parse(fs.readFileSync(configFile(), 'utf-8'))).toEqual(cfg)
    expect(loadAgentConfig('bot')).toEqual(cfg)
  })

  it('returns null for unknown agents and unreadable files', () => {
    expect(loadAgentConfig('bot')).toBeNull()
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.writeFileSync(configFile(), '{not json')
    expect(loadAgentConfig('bot')).toBeNull()
  })

  it('prefers the AGENT_<NAME>_CONFIG env var over disk', () => {
    saveAgentConfig('bot', config())
    vi.stubEnv('AGENT_BOT_CONFIG', JSON.stringify(config({ tools: ['send_eth'] })))
    expect(loadAgentConfig('bot')?.metadata.tools).toEqual(['send_eth'])
  })

  it('ignores invalid JSON in the env var and falls back to disk', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveAgentConfig('bot', config({ actions: ['ens-name'] }))
    vi.stubEnv('AGENT_BOT_CONFIG', '{oops')
    expect(loadAgentConfig('bot')?.metadata.actions).toEqual(['ens-name'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('AGENT_BOT_CONFIG'))
  })

  it('migrates legacy configs that keep actions at the top level', () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.writeFileSync(
      configFile(),
      JSON.stringify({
        name: 'bot',
        actions: ['transfer-eth'],
        standaloneTools: ['resolve_ens'],
        createdAt: '2025-05-05T00:00:00.000Z',
      }),
    )
    const loaded = loadAgentConfig('bot')!
    expect(loaded.metadata).toEqual({ actions: ['transfer-eth'], tools: ['resolve_ens'] })
    expect(loaded.createdAt).toBe('2025-05-05T00:00:00.000Z')
    expect(loaded.active).toBe(true)
  })

  it('renames metadata.standaloneTools to metadata.tools', () => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true })
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ ...config(), metadata: { actions: [], standaloneTools: ['send_eth'] } }),
    )
    const loaded = loadAgentConfig('bot')!
    expect(loaded.metadata.tools).toEqual(['send_eth'])
    expect(loaded.metadata).not.toHaveProperty('standaloneTools')
  })

  it('deletes the agent directory and reports whether anything was removed', () => {
    expect(deleteAgentConfig('bot')).toBe(false)
    saveAgentConfig('bot', config())
    expect(deleteAgentConfig('bot')).toBe(true)
    expect(fs.existsSync(path.join(dirs.agents, 'bot'))).toBe(false)
  })

  it('rethrows write failures locally but only warns on Vercel', () => {
    // An AGENTS_DIR nested under a regular file makes mkdir fail with ENOTDIR.
    const original = dirs.agents
    const blocker = path.join(original, 'blocker')
    fs.writeFileSync(blocker, '')
    dirs.agents = path.join(blocker, 'agents')
    try {
      expect(() => saveAgentConfig('bot', config())).toThrow()

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('VERCEL', '1')
      expect(() => saveAgentConfig('bot', config())).not.toThrow()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('AGENT_BOT_CONFIG'),
        expect.any(Error),
      )
    } finally {
      dirs.agents = original
      fs.rmSync(blocker, { force: true })
    }
  })
})

describe('resolveToolsFromConfig', () => {
  it('collects action tools + skills and dedupes standalone tools', () => {
    const { tools, skills } = resolveToolsFromConfig(
      config({ actions: ['transfer-eth'], tools: ['send_eth', 'resolve_ens', 'nope'] }),
    )
    const names = tools.map((t) => t.name)
    expect(names).toContain('send_eth')
    expect(names).toContain('get_token_balance')
    expect(names).toContain('resolve_ens')
    expect(names.filter((n) => n === 'send_eth')).toHaveLength(1)
    expect(skills.map((s) => s.name)).toEqual(['transfer-eth'])
  })

  it('skips unknown actions and tolerates missing metadata', () => {
    expect(resolveToolsFromConfig(config({ actions: ['ghost'] }))).toEqual({
      tools: [],
      skills: [],
    })
    const bare = { ...config(), metadata: undefined } as unknown as AgentConfig
    expect(resolveToolsFromConfig(bare)).toEqual({ tools: [], skills: [] })
  })
})

describe('buildCapabilitySummary', () => {
  it('lists actions with their bundled tools, then standalone tools', () => {
    const summary = buildCapabilitySummary(
      config({ actions: ['ens-name'], tools: ['send_eth', 'unknown'] }),
    )
    const lines = summary.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^- ens-name: .*\[tools: resolve_ens, lookup_ens/)
    expect(lines[1]).toMatch(/^- send_eth: /)
  })

  it('says so when nothing is configured', () => {
    expect(buildCapabilitySummary(config())).toBe('No capabilities configured.')
    expect(
      buildCapabilitySummary({ ...config(), metadata: undefined } as unknown as AgentConfig),
    ).toBe('No capabilities configured.')
  })
})

describe('parseAgentConfig', () => {
  it('accepts a valid config and returns an equal copy', () => {
    const cfg = config({ actions: ['transfer-eth'] })
    const parsed = parseAgentConfig(cfg)
    expect(parsed).toEqual(cfg)
    expect(parsed).not.toBe(cfg)
  })

  it('drops unknown top-level keys but keeps extra metadata', () => {
    const parsed = parseAgentConfig({
      ...config({ oasfSkills: ['602'] }),
      evil: '../../etc/passwd',
    })
    expect(parsed).not.toHaveProperty('evil')
    expect(parsed.metadata.oasfSkills).toEqual(['602'])
  })

  it.each([
    ['null', null],
    ['missing name', { ...config(), name: undefined }],
    ['wrong type', { ...config(), active: 'yes' }],
    ['oversized description', { ...config(), description: 'x'.repeat(10_001) }],
    ['bad endpoint type', { ...config(), endpoints: [{ type: 'FTP', value: 'x' }] }],
    ['non-array actions', { ...config(), metadata: { actions: 'transfer-eth', tools: [] } }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseAgentConfig(input)).toThrow()
  })
})
