import { describe, expect, it } from 'vitest'
import { agentDirPath, assertAgentName } from '../agent-path.js'

describe('assertAgentName', () => {
  it.each(['bot', 'my-bot_1', 'a.b', 'A'.repeat(63)])('accepts %s', (name) => {
    expect(assertAgentName(name)).toBe(name)
  })

  it.each(['', '../etc', 'a/b', 'a\\b', '/abs', '..', 'a..b', '.hidden', 'a b', 'A'.repeat(64)])(
    'rejects %j',
    (name) => {
      expect(() => assertAgentName(name)).toThrow(/Invalid agent name/)
    },
  )
})

describe('agentDirPath', () => {
  it('joins a valid name onto the base directory', () => {
    expect(agentDirPath('/base', 'bot')).toBe('/base/bot')
  })

  it('refuses traversal out of the base directory', () => {
    expect(() => agentDirPath('/base', '../outside')).toThrow(/Invalid agent name/)
  })
})
