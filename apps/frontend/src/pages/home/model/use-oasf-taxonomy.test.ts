import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const api = vi.hoisted(() => ({ fetchOasfDomains: vi.fn() }))
vi.mock('@/shared/api', () => ({ ...api, OASF_SCHEMA_URL: 'https://schema.test/' }))

import { useOasfTaxonomy } from './use-oasf-taxonomy'

const DOMAINS = [
  {
    id: '1',
    name: 'Language Processing',
    slug: 'language_processing',
    skills: [
      { id: '101', name: 'Summarization', slug: 'summarization' },
      { id: '102', name: 'Translation', slug: 'translation' },
    ],
  },
  {
    id: '6',
    name: 'Software Engineering',
    slug: 'software_engineering',
    skills: [{ id: '602', name: 'Web Development', slug: 'web_dev' }],
  },
]

async function setup(selected: string[] = []) {
  api.fetchOasfDomains.mockResolvedValue(DOMAINS)
  const skills = ref(selected)
  const t = useOasfTaxonomy(skills)
  await t.loadOasf()
  return { skills, t }
}

beforeEach(() => vi.resetAllMocks())

describe('loadOasf', () => {
  it('exposes the schema url and loads domains', async () => {
    const { t } = await setup()
    expect(t.oasfSchemaUrl).toBe('https://schema.test/')
    expect(t.visibleDomains.value).toHaveLength(2)
    expect(t.oasfLoading.value).toBe(false)
    expect(t.oasfError.value).toBe('')
  })

  it('reports fetch failures and stops loading', async () => {
    api.fetchOasfDomains.mockRejectedValue(new Error('boom'))
    const t = useOasfTaxonomy(ref([]))
    await t.loadOasf()
    expect(t.oasfError.value).toBe('boom')
    expect(t.oasfLoading.value).toBe(false)
  })

  it('falls back to a generic message for non-Error rejections', async () => {
    api.fetchOasfDomains.mockRejectedValue('x')
    const t = useOasfTaxonomy(ref([]))
    await t.loadOasf()
    expect(t.oasfError.value).toBe('Failed to load OASF taxonomy')
  })
})

describe('selection', () => {
  it('derives domains from selected skills', async () => {
    const { t } = await setup(['102', '602'])
    expect(t.selectedOasfDomains.value.sort()).toEqual(['1', '6'])
  })

  it('maps domain ids to slugs, passing unknown ids through', async () => {
    const { t } = await setup()
    expect(t.oasfDomainSlug('6')).toBe('software_engineering')
    expect(t.oasfDomainSlug('99')).toBe('99')
  })

  it('reports none / some / all skill state per domain', async () => {
    const { skills, t } = await setup()
    expect(t.domainSkillState('1')).toBe('none')
    skills.value = ['101']
    expect(t.domainSkillState('1')).toBe('some')
    skills.value = ['101', '102']
    expect(t.domainSkillState('1')).toBe('all')
    expect(t.domainSkillState('missing')).toBe('none')
  })

  it('toggles a single skill on and off', async () => {
    const { skills, t } = await setup()
    t.toggleOasfSkill('101')
    expect(skills.value).toEqual(['101'])
    t.toggleOasfSkill('101')
    expect(skills.value).toEqual([])
  })

  it('selects a whole domain, then deselects it', async () => {
    const { skills, t } = await setup(['101'])
    t.toggleOasfDomain('1')
    expect(skills.value.sort()).toEqual(['101', '102'])
    t.toggleOasfDomain('1')
    expect(skills.value).toEqual([])
    t.toggleOasfDomain('missing')
    expect(skills.value).toEqual([])
  })
})

describe('search', () => {
  it('filters domains and skills by name, id and domain name', async () => {
    const { t } = await setup()
    t.oasfSearch.value = 'transl'
    expect(t.visibleDomains.value.map((d) => d.id)).toEqual(['1'])
    expect(t.visibleSkills.value.map((s) => s.id)).toEqual(['102'])
    t.oasfSearch.value = 'software'
    expect(t.visibleSkills.value.map((s) => s.id)).toEqual(['602'])
    t.oasfSearch.value = '  '
    expect(t.visibleSkills.value).toHaveLength(3)
  })
})
