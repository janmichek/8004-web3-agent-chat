import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const redis = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = redis.get
    set = redis.set
  },
}))

beforeEach(() => {
  vi.resetModules()
  redis.get.mockReset()
  redis.set.mockReset()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('remoteMemoryEnabled', () => {
  it('returns true when KV env vars are set', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://x.upstash.io')
    vi.stubEnv('KV_REST_API_TOKEN', 'token123')
    const mod = await import('../memory-store.js')
    expect(mod.remoteMemoryEnabled()).toBe(true)
  })

  it('returns false when env vars are missing', async () => {
    const mod = await import('../memory-store.js')
    expect(mod.remoteMemoryEnabled()).toBe(false)
  })

  it('returns false when only one env var is set', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://x.upstash.io')
    const mod = await import('../memory-store.js')
    expect(mod.remoteMemoryEnabled()).toBe(false)
  })
})

describe('loadRemoteMemory', () => {
  it('returns null when redis is disabled', async () => {
    const mod = await import('../memory-store.js')
    const result = await mod.loadRemoteMemory('agent1')
    expect(result).toBeNull()
  })

  it('returns the stored string when redis is enabled', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://x.upstash.io')
    vi.stubEnv('KV_REST_API_TOKEN', 'token123')
    const mod = await import('../memory-store.js')
    redis.get.mockResolvedValue('{"storage":{}}')
    const result = await mod.loadRemoteMemory('agent1')
    expect(result).toBe('{"storage":{}}')
    expect(redis.get).toHaveBeenCalledWith('agent-memory:agent1')
  })

  it('returns null when redis returns null', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://x.upstash.io')
    vi.stubEnv('KV_REST_API_TOKEN', 'token123')
    const mod = await import('../memory-store.js')
    redis.get.mockResolvedValue(null)
    const result = await mod.loadRemoteMemory('agent1')
    expect(result).toBeNull()
  })
})

describe('saveRemoteMemory', () => {
  it('does nothing when redis is disabled', async () => {
    const mod = await import('../memory-store.js')
    await expect(mod.saveRemoteMemory('agent1', '{}')).resolves.toBeUndefined()
  })

  it('saves to redis when enabled', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://x.upstash.io')
    vi.stubEnv('KV_REST_API_TOKEN', 'token123')
    const mod = await import('../memory-store.js')
    redis.set.mockResolvedValue('OK')
    await mod.saveRemoteMemory('agent1', '{"storage":{}}')
    expect(redis.set).toHaveBeenCalledWith('agent-memory:agent1', '{"storage":{}}')
  })
})
