import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

const mockStorage: Record<string, any> = {}
const mockWrites: Record<string, any> = {}

vi.mock('@langchain/langgraph', () => ({
  MemorySaver: vi.fn().mockImplementation(function (this: any) {
    this.storage = mockStorage
    this.writes = mockWrites
  }),
}))

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

function resetModules() {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  Object.keys(mockWrites).forEach((k) => delete mockWrites[k])
}

describe('file-checkpoint (hydrate/serialize)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('hydrate populates storage from memory.json shape', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        storage: {
          thread1: {
            ns1: {
              key1: ['AQE=', 'AQI=', 'metadata'],
            },
          },
        },
        writes: {
          thread1: {
            write1: ['step1', 'output1', 'AQE='],
          },
        },
      }),
    )

    const mod = await import('../file-checkpoint.js')
    const { saver } = mod.createFileCheckpointer('test-agent')

    expect(saver.storage['thread1']['ns1']['key1']).toEqual([
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      'metadata',
    ])
    expect(saver.writes['thread1']['write1'][2]).toEqual(expect.any(Uint8Array))
  })

  it('flush writes base64-encoded JSON', async () => {
    const mod = await import('../file-checkpoint.js')
    const { flush } = mod.createFileCheckpointer('test-agent')
    flush()
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled()
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string)
    expect(typeof written).toBe('object')
    expect(written.storage).toBeDefined()
    expect(written.writes).toBeDefined()
  })
})

describe('createFileCheckpointer load paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('skips missing files and starts fresh', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const mod = await import('../file-checkpoint.js')
    const { saver } = mod.createFileCheckpointer('fresh-agent')
    expect(saver).toBeDefined()
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('warns and continues on corrupt JSON', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('not json {')
    const mod = await import('../file-checkpoint.js')
    const { saver } = mod.createFileCheckpointer('corrupt-agent')
    expect(saver).toBeDefined()
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0)
  })
})
