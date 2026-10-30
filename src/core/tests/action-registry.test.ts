import { describe, expect, it } from 'vitest'
import {
  ACTION_REGISTRY,
  TOOL_REGISTRY,
  getActionByName,
  getStandaloneToolInstance,
  getToolByName,
} from '../action-registry.js'

describe('registry consistency', () => {
  it('has unique action and tool names', () => {
    expect(new Set(ACTION_REGISTRY.map((a) => a.name)).size).toBe(ACTION_REGISTRY.length)
    expect(new Set(TOOL_REGISTRY.map((t) => t.name)).size).toBe(TOOL_REGISTRY.length)
  })

  it('every tool an action bundles is a registered tool', () => {
    for (const action of ACTION_REGISTRY) {
      for (const toolName of action.toolNames) {
        expect(getToolByName(toolName), `${action.name} → ${toolName}`).toBeDefined()
      }
    }
  })

  it('every registered tool has a live instance with a matching name', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(getStandaloneToolInstance(tool.name)?.name).toBe(tool.name)
    }
  })

  it('action factories build actions that expose their declared tools and skill', () => {
    for (const entry of ACTION_REGISTRY) {
      const action = entry.factory()
      expect(action.skill.name).toBe(entry.skillName)
    }
  })

  it('marks signing tools as not read-only', () => {
    const writes = TOOL_REGISTRY.filter((t) => !t.readOnly).map((t) => t.name)
    expect(writes.sort()).toEqual(['call_contract', 'register_ens', 'send_eth', 'set_primary_ens'])
  })
})

describe('lookups', () => {
  it('finds entries by name and returns undefined for unknown names', () => {
    expect(getActionByName('transfer-eth')?.toolNames).toContain('send_eth')
    expect(getActionByName('nope')).toBeUndefined()
    expect(getToolByName('resolve_ens')?.readOnly).toBe(true)
    expect(getToolByName('nope')).toBeUndefined()
    expect(getStandaloneToolInstance('nope')).toBeUndefined()
  })
})
