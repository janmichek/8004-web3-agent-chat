import { describe, expect, it } from 'vitest'
import { sortAgentsByLastUsed } from './api'

describe('sortAgentsByLastUsed', () => {
  it('puts latest lastActive first and leaves never-used at the end in original order', () => {
    const agents = [
      { name: 'never-a', lastActive: null },
      { name: 'old', lastActive: '2024-01-01T00:00:00.000Z' },
      { name: 'never-b', lastActive: undefined },
      { name: 'new', lastActive: '2025-06-01T12:00:00.000Z' },
    ]
    expect(sortAgentsByLastUsed(agents).map((a) => a.name)).toEqual([
      'new',
      'old',
      'never-a',
      'never-b',
    ])
  })

  it('does not mutate the input array', () => {
    const agents = [
      { name: 'a', lastActive: '2024-01-01T00:00:00.000Z' },
      { name: 'b', lastActive: '2025-01-01T00:00:00.000Z' },
    ]
    const sorted = sortAgentsByLastUsed(agents)
    expect(agents.map((a) => a.name)).toEqual(['a', 'b'])
    expect(sorted.map((a) => a.name)).toEqual(['b', 'a'])
  })
})
