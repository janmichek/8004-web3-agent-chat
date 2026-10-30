import { computed, ref, type Ref } from 'vue'
import { OASF_SCHEMA_URL, fetchOasfDomains, type OasfDomain } from '@/shared/api'

/** OASF domain/skill picker state. `selectedOasfSkills` is the single source of truth. */
export function useOasfTaxonomy(selectedOasfSkills: Ref<string[]>) {
  const oasfSearch = ref('')
  const oasfSchemaUrl = OASF_SCHEMA_URL
  const oasfDomains = ref<OasfDomain[]>([])
  const oasfLoading = ref(false)
  const oasfError = ref('')

  async function loadOasf() {
    oasfLoading.value = true
    oasfError.value = ''
    try {
      oasfDomains.value = await fetchOasfDomains()
    } catch (err) {
      oasfError.value = err instanceof Error ? err.message : 'Failed to load OASF taxonomy'
    } finally {
      oasfLoading.value = false
    }
  }

  // Single source of truth: selected skills. Domains are always derived,
  // so a domain/skill mismatch is impossible.
  const skillToDomain = computed(() => {
    const map = new Map<string, string>()
    for (const d of oasfDomains.value) for (const s of d.skills) map.set(s.id, d.id)
    return map
  })

  const selectedOasfDomains = computed(() => {
    const ids = new Set<string>()
    for (const skillId of selectedOasfSkills.value) {
      const domainId = skillToDomain.value.get(skillId)
      if (domainId) ids.add(domainId)
    }
    return [...ids]
  })

  const oasfDomainSlugs = computed(() => {
    const map = new Map<string, string>()
    for (const d of oasfDomains.value) map.set(d.id, d.slug)
    return map
  })

  function oasfDomainSlug(id: string): string {
    return oasfDomainSlugs.value.get(id) ?? id
  }

  function domainSkillState(domainId: string): 'none' | 'some' | 'all' {
    const domain = oasfDomains.value.find((d) => d.id === domainId)
    if (!domain) return 'none'
    const count = domain.skills.filter((s) => selectedOasfSkills.value.includes(s.id)).length
    if (count === 0) return 'none'
    return count === domain.skills.length ? 'all' : 'some'
  }

  const visibleDomains = computed(() => {
    const q = oasfSearch.value.trim().toLowerCase()
    if (!q) return oasfDomains.value
    return oasfDomains.value.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.id.includes(q) ||
        d.skills.some((s) => s.name.toLowerCase().includes(q) || s.id.includes(q)),
    )
  })

  const visibleSkills = computed(() => {
    const q = oasfSearch.value.trim().toLowerCase()
    const all = oasfDomains.value.flatMap((d) =>
      d.skills.map((s) => ({ ...s, domainId: d.id, domainName: d.name })),
    )
    if (!q) return all
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.includes(q) ||
        s.domainName.toLowerCase().includes(q),
    )
  })

  function toggleOasfDomain(id: string) {
    const domain = oasfDomains.value.find((d) => d.id === id)
    if (!domain) return
    const allSelected = domain.skills.every((s) => selectedOasfSkills.value.includes(s.id))
    if (allSelected) {
      // Deselect: remove all skills of this domain
      const skillIds = new Set(domain.skills.map((s) => s.id))
      selectedOasfSkills.value = selectedOasfSkills.value.filter((s) => !skillIds.has(s))
    } else {
      // Select: add all skills of this domain
      for (const s of domain.skills) {
        if (!selectedOasfSkills.value.includes(s.id)) selectedOasfSkills.value.push(s.id)
      }
    }
  }

  function toggleOasfSkill(id: string) {
    const i = selectedOasfSkills.value.indexOf(id)
    if (i >= 0) selectedOasfSkills.value.splice(i, 1)
    else selectedOasfSkills.value.push(id)
  }

  return {
    oasfSearch,
    oasfSchemaUrl,
    oasfLoading,
    oasfError,
    selectedOasfDomains,
    visibleDomains,
    visibleSkills,
    loadOasf,
    oasfDomainSlug,
    domainSkillState,
    toggleOasfDomain,
    toggleOasfSkill,
  }
}
