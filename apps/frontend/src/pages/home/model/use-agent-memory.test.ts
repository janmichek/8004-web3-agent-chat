import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummary } from '@/shared/api'

const api = vi.hoisted(() => ({ fetchMemory: vi.fn() }))
vi.mock('@/shared/api', () => api)

import { useAgentMemory } from './use-agent-memory'

const agentFixture = (name: string) => ({ name }) as AgentSummary

const memoryFixture = (overrides: Record<string, unknown> = {}) => ({
  empty: false,
  sessions: [],
  threads: [],
  checkpointCount: 0,
  lastActive: null,
  recentTxHashes: [],
  ...overrides,
})

beforeEach(() => vi.resetAllMocks())

describe('useAgentMemory', () => {
  it('clears state when no agent is selected', async () => {
    const agent = ref<AgentSummary | null>(null)
    const { memory, error } = useAgentMemory(() => agent.value)
    await Promise.resolve()
    expect(memory.value).toBeNull()
    expect(error.value).toBe('')
    expect(api.fetchMemory).not.toHaveBeenCalled()
  })

  it('loads memory for the selected agent and exposes it', async () => {
    api.fetchMemory.mockResolvedValue(memoryFixture({ checkpointCount: 3 }))
    const agent = ref<AgentSummary | null>(agentFixture('alice'))
    const { memory, loading } = useAgentMemory(() => agent.value)
    await vi.waitFor(() => expect(memory.value?.checkpointCount).toBe(3))
    expect(api.fetchMemory).toHaveBeenCalledWith('alice')
    expect(loading.value).toBe(false)
  })

  it('reloads when the refresh key changes', async () => {
    api.fetchMemory.mockResolvedValue(memoryFixture())
    const agent = ref<AgentSummary | null>(agentFixture('alice'))
    const refreshKey = ref(0)
    useAgentMemory(
      () => agent.value,
      () => refreshKey.value,
    )
    await vi.waitFor(() => expect(api.fetchMemory).toHaveBeenCalledTimes(1))
    refreshKey.value += 1
    await vi.waitFor(() => expect(api.fetchMemory).toHaveBeenCalledTimes(2))
  })

  it('surfaces fetch errors and resets memory', async () => {
    api.fetchMemory.mockRejectedValue(new Error('boom'))
    const agent = ref<AgentSummary | null>(agentFixture('alice'))
    const { memory, error, loading } = useAgentMemory(() => agent.value)
    await vi.waitFor(() => expect(error.value).toBe('boom'))
    expect(memory.value).toBeNull()
    expect(loading.value).toBe(false)
  })
})
