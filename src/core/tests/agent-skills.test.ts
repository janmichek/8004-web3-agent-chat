import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const dirs = vi.hoisted(() => ({ agents: '' }))
vi.mock('../wallet.js', () => ({
  get AGENTS_DIR() {
    return dirs.agents
  },
}))

import {
  buildSkillSystemPrompt,
  discoverAgentSkills,
  listAgentSkills,
  resolveAgentSkills,
} from '../agent-skills.js'

function writeSkill(agent: string, skill: string, files: Record<string, string>) {
  const dir = path.join(dirs.agents, agent, 'skills', skill)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), content)
}

beforeAll(() => {
  dirs.agents = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-'))
})
afterAll(() => fs.rmSync(dirs.agents, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

describe('discoverAgentSkills', () => {
  it('returns [] when the agent has no skills directory', () => {
    expect(discoverAgentSkills('ghost')).toEqual([])
  })

  it('parses SKILL.md frontmatter and body, skipping non-skill entries', () => {
    writeSkill('alice', 'greeter', {
      'SKILL.md': '---\nname: "greeter"\ndescription: Says hi\n---\nAlways greet.\n',
    })
    writeSkill('alice', 'bare', { 'SKILL.md': 'No frontmatter here' })
    writeSkill('alice', 'no-md', { 'index.ts': '' })
    fs.writeFileSync(path.join(dirs.agents, 'alice', 'skills', 'stray.txt'), 'x')

    const skills = discoverAgentSkills('alice')
    expect(skills).toHaveLength(2)
    expect(skills).toContainEqual({
      name: 'greeter',
      description: 'Says hi',
      instructions: 'Always greet.',
    })
    expect(skills).toContainEqual({
      name: 'bare',
      description: undefined,
      instructions: 'No frontmatter here',
    })
    expect(listAgentSkills('alice').sort()).toEqual(['bare', 'greeter'])
  })
})

describe('buildSkillSystemPrompt', () => {
  it('joins only skills that have instructions', () => {
    expect(
      buildSkillSystemPrompt([
        { name: 'a', instructions: 'do a' },
        { name: 'b' },
        { name: 'c', instructions: 'do c' },
      ]),
    ).toBe('## Skill: a\n\ndo a\n\n## Skill: c\n\ndo c')
  })

  it('returns an empty string when nothing has instructions', () => {
    expect(buildSkillSystemPrompt([{ name: 'a' }])).toBe('')
  })
})

describe('resolveAgentSkills', () => {
  it('returns [] when the agent has no skills directory', async () => {
    expect(await resolveAgentSkills('ghost', '0xkey')).toEqual([])
  })

  it('loads valid factories and skips broken or incomplete skills', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeSkill('bob', 'good', {
      'index.ts': 'export const createSkill = (key: string) => ({ name: "good:" + key })',
    })
    writeSkill('bob', 'default-export', {
      'index.ts': 'export default (key: string) => ({ name: "dflt:" + key })',
    })
    writeSkill('bob', 'no-index', { 'SKILL.md': '---\nname: x\n---\n' })
    writeSkill('bob', 'not-a-fn', { 'index.ts': 'export const createSkill = 42' })
    writeSkill('bob', 'throws', { 'index.ts': 'throw new Error("kaboom")' })
    fs.writeFileSync(path.join(dirs.agents, 'bob', 'skills', 'stray.txt'), 'x')

    const tools = await resolveAgentSkills('bob', '0xkey')
    expect(tools.map((t) => t.name).sort()).toEqual(['dflt:0xkey', 'good:0xkey'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no-index'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-fn'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('kaboom'))
  })
})
