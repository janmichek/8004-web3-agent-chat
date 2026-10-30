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

const store = vi.hoisted(() => ({ enabled: false, text: null as string | null }))
vi.mock('../memory-store.js', () => ({
  remoteMemoryEnabled: () => store.enabled,
  loadRemoteMemory: async () => store.text,
}))

import { readAgentMemoryAsync } from '../memory-reader.js'

const ADDR_A = '0x' + 'a'.repeat(40)
const ADDR_B = '0x' + 'b'.repeat(40)
const TX = '0x' + '1'.repeat(64)

type Msg = {
  kind: 'Human' | 'AI' | 'Tool' | 'System' | 'Other'
  content: unknown
  id?: string
  name?: string
  toolCalls?: { name: string; args: unknown }[]
}

const raw = (m: Msg) => ({
  lc: 1,
  type: 'constructor',
  id: ['langchain_core', 'messages', m.kind === 'Other' ? 'Weird' : `${m.kind}Message`],
  kwargs: { content: m.content, id: m.id, name: m.name, tool_calls: m.toolCalls },
})

/** One checkpoint entry in the LangGraph file format: base64(JSON) at index 0. */
function checkpoint(id: string, ts: string, messages: Msg[]): [string, string, null] {
  const cp = { v: 1, id, ts, channel_values: { messages: messages.map(raw) } }
  return [Buffer.from(JSON.stringify(cp)).toString('base64'), '', null]
}

function writeMemory(agent: string, storage: unknown) {
  const dir = path.join(dirs.agents, agent)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify({ storage }))
}

beforeAll(() => {
  dirs.agents = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-reader-'))
})
afterAll(() => fs.rmSync(dirs.agents, { recursive: true, force: true }))
beforeEach(() => {
  store.enabled = false
  store.text = null
  vi.stubEnv('VERCEL', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('missing / empty memory', () => {
  it('reports an agent without a memory file as not existing', async () => {
    const m = await readAgentMemoryAsync('ghost')
    expect(m).toMatchObject({ agent: 'ghost', exists: false, empty: true, sessions: [] })
    expect(m.summary).toBe('No conversation history yet.')
  })

  it('treats empty storage as existing but empty', async () => {
    writeMemory('blank', {})
    expect(await readAgentMemoryAsync('blank')).toMatchObject({ exists: true, empty: true })
  })

  it('skips unreadable files', async () => {
    const dir = path.join(dirs.agents, 'broken')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'memory.json'), '{nope')
    expect((await readAgentMemoryAsync('broken')).exists).toBe(false)
  })

  it('counts corrupt checkpoints but reports no conversation', async () => {
    writeMemory('corrupt', { t1: { '': { c1: ['not-base64-json', '', null] } } })
    const m = await readAgentMemoryAsync('corrupt')
    expect(m).toMatchObject({ exists: true, empty: true, checkpointCount: 1, threads: ['t1'] })
  })
})

describe('conversation summary', () => {
  const T0 = '2026-01-01T10:00:00.000Z'
  const T1 = '2026-01-01T10:00:05.000Z'
  const T2 = '2026-01-01T10:00:09.000Z'

  beforeEach(() => {
    const first: Msg[] = [{ kind: 'Human', content: `send 0.5 to ${ADDR_A}`, id: 'm1' }]
    const second: Msg[] = [
      ...first,
      {
        kind: 'AI',
        content: '',
        id: 'm2',
        toolCalls: [{ name: 'send_eth', args: { to: ADDR_A, amount: '0.5' } }],
      },
    ]
    const third: Msg[] = [
      ...second,
      { kind: 'Tool', content: `sent ${TX} to ${ADDR_B}`, id: 'm3', name: 'send_eth' },
      { kind: 'AI', content: [{ type: 'text', text: 'Done' }, 'ok'], id: 'm4' },
      { kind: 'System', content: 'sys', id: 'm5' },
      { kind: 'Other', content: '   ', id: 'm6' },
    ]
    writeMemory('alice', {
      thread1: {
        '': {
          c3: checkpoint('c3', T2, third),
          c1: checkpoint('c1', T0, first),
          c2: checkpoint('c2', T1, second),
        },
      },
    })
  })

  it('decodes messages in order, deduped across checkpoints, dropping blank unknowns', async () => {
    const m = await readAgentMemoryAsync('alice')
    expect(m.exists).toBe(true)
    expect(m.empty).toBe(false)
    expect(m.checkpointCount).toBe(3)
    expect(m.firstActive).toBe(T0)
    expect(m.lastActive).toBe(T2)
    expect(m.preview.map((p) => p.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'system',
    ])
    expect(m.preview[3]!.content).toBe('Done\nok')
    expect(m.preview[2]!.name).toBe('send_eth')
    expect(m.preview[0]!.ts).toBe(T0)
  })

  it('aggregates stats: counts, tool calls, recipients, tx hashes, ETH sent', async () => {
    const { stats, recentTxHashes, summary } = await readAgentMemoryAsync('alice')
    expect(stats).toMatchObject({
      totalMessages: 5,
      humanCount: 1,
      aiCount: 2,
      toolCount: 1,
      toolCallsByName: { send_eth: 1 },
      txHashes: [TX],
      totalEthSent: '0.5',
    })
    expect(stats.uniqueRecipients.sort()).toEqual([ADDR_A, ADDR_B])
    expect(recentTxHashes).toEqual([TX])
    expect(summary).toMatch(/5 messages in 1 exchanges/)
    expect(summary).toMatch(/1 tool results/)
    expect(summary).toMatch(/top tool: send_eth ×1/)
    expect(summary).toMatch(/2 addresses touched/)
    expect(summary).toMatch(/1 tx sent/)
    expect(summary).toMatch(/≈0\.5 ETH moved/)
    expect(summary).toMatch(/last \d+d ago/)
  })

  it('groups messages into one session when there is no long idle gap', async () => {
    const { sessions } = await readAgentMemoryAsync('alice')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      index: 0,
      messageCount: 5,
      humanCount: 1,
      assistantCount: 2,
      toolCount: 1,
      preview: `send 0.5 to ${ADDR_A}`.slice(0, 64),
    })
    expect(sessions[0]!.summary).toMatch(/5 msgs · 1 tx · 2 addr/)
    expect(sessions[0]!.title).toMatch(/· 1 prompt$/)
  })
})

describe('sessions', () => {
  it('splits after a 20+ minute idle gap', async () => {
    const msgs = (n: number): Msg[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: i % 2 === 0 ? 'Human' : 'AI',
        content: `m${i}`,
        id: `m${i}`,
      }))
    writeMemory('bob', {
      t: {
        '': {
          a: checkpoint('a', '2026-01-01T10:00:00.000Z', msgs(2)),
          b: checkpoint('b', '2026-01-01T11:00:00.000Z', msgs(4)),
        },
      },
    })
    const { sessions } = await readAgentMemoryAsync('bob')
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.messageCount)).toEqual([2, 2])
    expect(sessions[1]!.title).toMatch(/· 1 prompt$/)
  })

  it('pluralises prompts and handles messages without ids', async () => {
    writeMemory('carol', {
      t: {
        '': {
          a: checkpoint('a', '2026-01-01T10:00:00.000Z', [
            { kind: 'Human', content: 'one' },
            { kind: 'Human', content: 'two' },
          ]),
        },
      },
    })
    const { sessions, stats } = await readAgentMemoryAsync('carol')
    expect(stats.humanCount).toBe(2)
    expect(sessions[0]!.title).toMatch(/· 2 prompts$/)
  })
})

describe('remote store', () => {
  it('prefers remote memory when enabled and present', async () => {
    store.enabled = true
    store.text = JSON.stringify({
      storage: {
        t: {
          '': {
            a: checkpoint('a', '2026-01-01T10:00:00.000Z', [
              { kind: 'Human', content: 'hi', id: 'x' },
            ]),
          },
        },
      },
    })
    const m = await readAgentMemoryAsync('alice')
    expect(m.stats.totalMessages).toBe(1)
    expect(m.preview[0]!.content).toBe('hi')
  })

  it('falls back to disk when the remote store has nothing', async () => {
    store.enabled = true
    store.text = null
    expect((await readAgentMemoryAsync('ghost')).exists).toBe(false)
  })
})

describe('Vercel', () => {
  it('also looks in cwd/agents as a read fallback', async () => {
    vi.stubEnv('VERCEL', '1')
    expect((await readAgentMemoryAsync('definitely-not-here')).exists).toBe(false)
  })
})
