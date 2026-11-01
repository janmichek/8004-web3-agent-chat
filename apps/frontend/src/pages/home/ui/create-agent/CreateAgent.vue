<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { getAccount } from '@wagmi/vue/actions'
import { useAccount, useConfig } from '@wagmi/vue'
import { type Address } from 'viem'
import {
  createAgent,
  fetchCatalog,
  saveAgentBackup,
  type AgentSummary,
  type CatalogNetwork,
  type CatalogResponse,
} from '@/shared/api'
import { DEFAULT_CHAIN_ID } from '@/shared/config'
import { e2eConnectedAddress } from '@/shared/lib'
import NetworkSelect from './NetworkSelect.vue'
import CreateAgentDone from './CreateAgentDone.vue'
import AgentCard from '../agent-card/AgentCard.vue'

import { useAgentImage } from '../../model/use-agent-image'
import { useOasfTaxonomy } from '../../model/use-oasf-taxonomy'

type Phase =
  | 'env'
  | 'configure'
  | 'oasf'
  | 'creating'
  | 'done'
  | 'error'

const emit = defineEmits<{
  created: [agent: AgentSummary]
  cancel: []
}>()

const wagmiConfig = useConfig()
const { address: wagmiAddress } = useAccount()

/** The signed-in wallet becomes the owner of the identity NFT. */
const connectedAddress = computed<Address | undefined>(
  () => e2eConnectedAddress() ?? wagmiAddress.value ?? getAccount(wagmiConfig).address,
)
const phase = ref<Phase>('env')
const bodyRef = ref<HTMLElement | null>(null)

watch(phase, async () => {
  await nextTick()
  bodyRef.value?.scrollTo({ top: 0 })
})
const catalog = ref<CatalogResponse | null>(null)
const loadError = ref('')
// Chain the agent is created on; starts at the server default.
const selectedChainId = ref(DEFAULT_CHAIN_ID)
const networks = computed<CatalogNetwork[]>(() => {
  const c = catalog.value
  if (!c) return []
  return (
    c.networks ?? [
      { network: c.network, name: c.networkName, chainId: c.chainId, masterBalanceEth: c.master.balanceEth },
    ]
  )
})
const createError = ref('')
const busy = ref(false)

const STEPS = [
  { key: 'env', label: 'Identity' },
  { key: 'configure', label: 'Abilities' },
  { key: 'oasf', label: 'Skills' },
] as const
const stepIndex = computed(() => STEPS.findIndex((s) => s.key === phase.value))
const isStepPhase = computed(() => stepIndex.value >= 0)
const selectedNetworkName = computed(
  () => networks.value.find((n) => n.chainId === selectedChainId.value)?.name ?? '',
)
const headTitle = computed(() => {
  switch (phase.value) {
    case 'env':
      return 'Name your agent'
    case 'configure':
      return 'Choose abilities'
    case 'oasf':
      return 'Add skills'
    case 'creating':
      return 'Creating your agent'
    case 'done':
      return "You're live"
    default:
      return 'Something went wrong'
  }
})
const headSubtitle = computed(() => {
  switch (phase.value) {
    case 'env':
      return ''
    case 'configure':
      return 'Toggle what it can do. Anything here can be changed later.'
    case 'oasf':
      return 'Optional discovery tags so other agents can find yours.'
    case 'done':
      return 'Your identity is issued — fund its wallet, then say hello.'
    default:
      return ''
  }
})
const UPPERCASE_WORDS = new Set(['eth', 'ens', 'abi', 'mcp', 'a2a', 'oasf', 'ipfs', 'usdc', 'api', 'erc', 'nft'])
function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase()
      if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase()
      if (lower === 'x402') return 'x402'
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

const agentName = ref('')
const agentDescription = ref('')
const selectedActions = ref<string[]>([])
const selectedTools = ref<string[]>([])
const selectedOasfSkills = ref<string[]>([])
const {
  oasfSearch,
  oasfSchemaUrl,
  oasfLoading,
  oasfError,
  selectedOasfDomains,
  visibleDomains,
  visibleSkills,
  loadOasf,
  domainSkillState,
  toggleOasfDomain,
  toggleOasfSkill,
} = useOasfTaxonomy(selectedOasfSkills)
const {
  imageFile,
  imagePreviewUrl,
  imageStatus,
  imageError,
  selectImage,
  removeImage,
  uploadSelectedImage,
} = useAgentImage()
const draftAgent = computed(() => ({
  name: agentName.value,
  description: agentDescription.value,
  image: imagePreviewUrl.value || undefined,
  walletChainId: selectedChainId.value,
}))
const webEndpoint = ref('https://example.com')
const emailEndpoint = ref('e@mail.fun')
const mcpEndpoint = ref(
  typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '',
)

// A2A: defaults to this app's endpoint scoped to the agent being named, so the
// advertised Agent Card is this agent's (not the generic one). Typing in the
// field takes over; clearing it means "no A2A".
const a2aEdited = ref<string | null>(null)
const a2aDefault = computed(() => {
  const scope = nameValid.value ? `?agent=${encodeURIComponent(agentName.value.trim())}` : ''
  return `${window.location.origin}/api/a2a${scope}`
})
const a2aEndpoint = computed({
  get: () => a2aEdited.value ?? a2aDefault.value,
  set: (value: string) => {
    a2aEdited.value = value
  },
})
const hasA2a = computed(() => a2aEndpoint.value.trim().length > 0)

// x402: off by default while the server only simulates payments, on once a
// real facilitator is configured. The user's own choice always wins.
const x402Choice = ref<boolean | null>(null)
const x402Live = computed(() => catalog.value?.x402?.mode === 'facilitator')
const x402Enabled = computed({
  get: () => hasA2a.value && (x402Choice.value ?? x402Live.value),
  set: (value: boolean) => {
    x402Choice.value = value
  },
})

const hasSelectedCapabilities = computed(
  () => selectedActions.value.length > 0 || selectedTools.value.length > 0,
)
const mcpMissingWarning = computed(
  () => hasSelectedCapabilities.value && !mcpEndpoint.value.trim(),
)

const createdAgent = ref<AgentSummary | null>(null)
const createdBalance = ref('')
const createdPrivateKey = ref('')
const createdPrivateKeyEnvVar = ref('')
const createdEphemeralWarning = ref('')

const nameValid = computed(() =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(agentName.value.trim()),
)

async function loadCatalog() {
  loadError.value = ''
  try {
    catalog.value = await fetchCatalog()
    selectedChainId.value = catalog.value.chainId
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : 'Failed to load catalog — is the API running?'
  }
}

onMounted(() => {
  void loadCatalog()
  void loadOasf()
})

/** Tools an action already includes, so they must not also be picked standalone. */
function bundledTools(actionName: string): string[] {
  return catalog.value?.actions.find((a) => a.name === actionName)?.toolNames ?? []
}

/** Action that already includes this tool, if the catalog lists one. */
function bundlingAction(toolName: string): string | undefined {
  return catalog.value?.actions.find((a) => a.toolNames.includes(toolName))?.name
}

function isToolDisabled(name: string): boolean {
  const action = bundlingAction(name)
  return action != null && selectedActions.value.includes(action)
}

function isActionDisabled(name: string): boolean {
  return bundledTools(name).some((t) => selectedTools.value.includes(t))
}

function toggleAction(name: string) {
  const i = selectedActions.value.indexOf(name)
  if (i >= 0) {
    selectedActions.value.splice(i, 1)
    return
  }
  if (isActionDisabled(name)) return
  selectedActions.value.push(name)
}

function toggleTool(name: string) {
  if (isToolDisabled(name)) return
  const i = selectedTools.value.indexOf(name)
  if (i >= 0) selectedTools.value.splice(i, 1)
  else selectedTools.value.push(name)
}

function goConfigure() {
  if (!nameValid.value) return
  if (!connectedAddress.value) {
    createError.value = 'Connect and sign in with a wallet to create an agent.'
    return
  }
  phase.value = 'configure'
}

async function submitCreate() {
  if (busy.value) return
  if (!connectedAddress.value) {
    createError.value = 'Connect and sign in with a wallet to create an agent.'
    phase.value = 'error'
    return
  }
  phase.value = 'creating'
  createError.value = ''
  createdAgent.value = null
  createdPrivateKey.value = ''
  createdPrivateKeyEnvVar.value = ''
  createdEphemeralWarning.value = ''
  busy.value = true

  try {
    // Upload the image now (if one was picked and not yet uploaded),
    // just before the agent metadata is pinned during creation.
    const imageUriToSend = await uploadSelectedImage()

    const services = [
      { name: 'web', endpoint: webEndpoint.value.trim() },
      { name: 'email', endpoint: emailEndpoint.value.trim() },
      { name: 'mcp', endpoint: mcpEndpoint.value.trim() },
      { name: 'A2A', endpoint: a2aEndpoint.value.trim() },
    ].filter((s) => s.endpoint.length > 0)

    const res = await createAgent({
      name: agentName.value.trim(),
      owner: connectedAddress.value,
      chainId: selectedChainId.value,
      description: agentDescription.value.trim() || undefined,
      imageUri: imageUriToSend,
      actions: selectedActions.value,
      tools: selectedTools.value,
      oasfDomains: selectedOasfDomains.value,
      oasfSkills: selectedOasfSkills.value,
      services,
      x402support: x402Enabled.value,
    })
    createdAgent.value = res.agent
    createdBalance.value = res.balanceEth
    createdPrivateKey.value = res.privateKey ?? ''
    createdPrivateKeyEnvVar.value = res.privateKeyEnvVar ?? ''
    createdEphemeralWarning.value = res.ephemeralWarning ?? ''
    // Keep a browser backup of ephemeral agents so cold serverless
    // instances can be healed transparently (restore-and-retry on 404).
    if (res.privateKey && res.config) {
      saveAgentBackup(res.agent.name, res.config, res.privateKey)
    }
    phase.value = 'done'
  } catch (err) {
    createError.value = err instanceof Error ? err.message : String(err)
    phase.value = 'error'
  } finally {
    busy.value = false
  }
}

function openChat() {
  if (createdAgent.value) emit('created', createdAgent.value)
}

</script>

<template>
  <section class="wizard" data-testid="create-dialog">
    <header class="head">
      <div class="head-copy">
        <span class="eyebrow">Create agent</span>
        <h2>{{ headTitle }}</h2>
        <p v-if="headSubtitle" class="head-sub">{{ headSubtitle }}</p>
      </div>
      <button
        type="button"
        class="btn ghost small icon-btn"
        aria-label="Close"
        title="Close"
        :disabled="busy"
        @click="emit('cancel')"
      >
        ✕
      </button>
    </header>

    <nav v-if="isStepPhase" class="stepper" aria-label="Progress">
      <div
        v-for="(s, i) in STEPS"
        :key="s.key"
        class="stepper-item"
        :class="{ active: i === stepIndex, done: i < stepIndex }"
      >
        <span class="stepper-dot">
          <svg v-if="i < stepIndex" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="stepper-name">{{ s.label }}</span>
        <span v-if="i < STEPS.length - 1" class="stepper-line" aria-hidden="true" />
      </div>
    </nav>

    <p v-if="loadError" class="banner" data-testid="create-load-error">{{ loadError }}</p>

    <!-- Step 1 — identity, network, connections -->
    <div v-else-if="phase === 'env'" ref="bodyRef" class="body">
      <div class="panel-head">
        <div>
          <p class="section-title">Identity <span class="optional">required</span></p>
          <p class="hint">Name, image, and how people and other agents reach it.</p>
        </div>
        <span v-if="catalog" class="count-pill" data-testid="create-network-pill">
          {{ selectedNetworkName }}
        </span>
      </div>

      <div class="env-grid">
        <section class="env-col">
          <p class="group-label">Details</p>

          <AgentCard
            editable
            status="draft"
            :agent="draftAgent"
            :image-file-name="imageFile?.name"
            :image-status="imageStatus"
            :image-error="imageError"
            @update:name="agentName = $event"
            @update:description="agentDescription = $event"
            @image-chosen="selectImage"
            @image-removed="removeImage"
            :owner="catalog ? connectedAddress : undefined"
            :creator="catalog ? connectedAddress : undefined"
            @submit="goConfigure"
          >
            <template v-if="catalog" #network>
              <NetworkSelect
                v-model="selectedChainId"
                :networks="networks"
                :disabled="networks.length < 2"
                aria-label="Network"
                test-id="create-network"
                compact
              />
            </template>
          </AgentCard>
          <p
            v-if="agentName.trim() && !nameValid"
            class="hint error"
            data-testid="create-name-error"
          >
            Use letters, numbers and . _ - (1–63 chars).
          </p>

          <p v-if="!catalog" class="hint network-loading">Loading environment…</p>
          <p v-if="!connectedAddress" class="note warn" data-testid="create-owner-warning">
            Connect a wallet first — it becomes the owner of the identity NFT.
          </p>
        </section>

        <section class="env-col">
          <p class="group-label">Connections <span>optional</span></p>

          <label class="field row-card">
            <span>Web</span>
            <input
              v-model="webEndpoint"
              type="text"
              placeholder="https://example.com"
              spellcheck="false"
              data-testid="create-web-endpoint"
            />
          </label>
          <label class="field row-card">
            <span>Email</span>
            <input
              v-model="emailEndpoint"
              type="text"
              placeholder="e@mail.fun"
              spellcheck="false"
              data-testid="create-email-endpoint"
            />
          </label>
          <label class="field row-card">
            <span>MCP <span class="optional">tool discovery</span></span>
            <input
              v-model="mcpEndpoint"
              type="text"
              placeholder="https://your-host/api/mcp"
              spellcheck="false"
              data-testid="create-mcp-endpoint"
            />
          </label>
          <label class="field row-card">
            <span>A2A <span class="optional">agent-to-agent</span></span>
            <input
              v-model="a2aEndpoint"
              type="text"
              placeholder="https://your-host/api/a2a"
              spellcheck="false"
              data-testid="create-a2a-endpoint"
            />
          </label>
          <p v-if="mcpMissingWarning" class="note warn" data-testid="create-mcp-warning">
            No MCP endpoint set — abilities will run in chat only and won't be advertised on
            8004scan. Add an https://…/api/mcp URL to publish them.
          </p>
          <p class="hint subtle" data-testid="create-a2a-hint">
            <template v-if="hasA2a">
              A2A callers get read-only tools only — this agent never sends funds or signs
              transactions for outside callers.
            </template>
            <template v-else>No A2A endpoint — other agents can't reach this one, and x402 is off.</template>
          </p>
          <label class="check row-card" :class="{ disabled: !hasA2a }">
            <input
              v-model="x402Enabled"
              type="checkbox"
              :disabled="!hasA2a"
              data-testid="create-x402"
            />
            <span>
              <strong>Charge for A2A requests (x402)</strong>
              <em v-if="x402Live" data-testid="create-x402-hint">
                Callers pay 0.01 USDC on Base Sepolia to the agent wallet per request. The agent
                is only paid after it has answered.
              </em>
              <em v-else data-testid="create-x402-hint">
                Test mode — payments are simulated and nobody is charged. It still shows as
                x402-ready on 8004scan.
              </em>
            </span>
          </label>
        </section>
      </div>

      <div class="nav">
        <div class="nav-end">
          <span class="nav-note">Step 1 of 3</span>
          <button
            type="button"
            class="btn primary"
            data-testid="create-name-continue"
            :disabled="!catalog || !nameValid || !connectedAddress"
            @click="goConfigure"
          >
            Next →
          </button>
        </div>
      </div>
    </div>

    <!-- Configure (step 2) — abilities -->
    <div v-else-if="phase === 'configure'" ref="bodyRef" class="body">
      <div class="panel-head">
        <div>
          <p class="section-title">Abilities</p>
          <p class="hint">Pick what your agent can do. Actions bundle related tools together.</p>
        </div>
        <span class="count-pill">{{ selectedActions.length + selectedTools.length }} selected</span>
      </div>
      <p v-if="mcpMissingWarning" class="note warn" data-testid="create-mcp-warning-configure">
        No MCP endpoint set — your selection won't appear on 8004scan. Go back to step 1
        and add an https://…/api/mcp URL.
      </p>

      <section v-if="(catalog?.actions ?? []).length" class="ability-group">
        <p class="group-label">Actions <span>multi-step abilities</span></p>
        <div class="ability-grid">
          <label
            v-for="a in catalog?.actions ?? []"
            :key="`action-${a.name}`"
            class="ability"
            :class="{ disabled: isActionDisabled(a.name), on: selectedActions.includes(a.name) }"
          >
            <input
              type="checkbox"
              :data-testid="`create-action-${a.name}`"
              :checked="selectedActions.includes(a.name)"
              :disabled="isActionDisabled(a.name)"
              @change="toggleAction(a.name)"
            />
            <span class="ability-body">
              <span class="ability-top">
                <strong>{{ humanize(a.name) }}</strong>
                <span class="badge">Action</span>
              </span>
              <em>{{ a.description }}</em>
              <span v-if="isActionDisabled(a.name)" class="chip lock">
                Uses a tool you already selected
              </span>
              <span v-else class="chips">
                <span v-for="tool in a.toolNames" :key="tool" class="chip">
                  {{ humanize(tool) }}
                </span>
              </span>
            </span>
          </label>
        </div>
      </section>

      <section v-if="(catalog?.tools ?? []).length" class="ability-group">
        <p class="group-label">Tools <span>single-step actions</span></p>
        <div class="ability-grid">
          <label
            v-for="t in catalog?.tools ?? []"
            :key="`tool-${t.name}`"
            class="ability"
            :class="{ disabled: isToolDisabled(t.name), on: selectedTools.includes(t.name) }"
          >
            <input
              type="checkbox"
              :data-testid="`create-tool-${t.name}`"
              :checked="selectedTools.includes(t.name)"
              :disabled="isToolDisabled(t.name)"
              @change="toggleTool(t.name)"
            />
            <span class="ability-body">
              <span class="ability-top">
                <strong>{{ humanize(t.name) }}</strong>
                <span class="badge tool">Tool</span>
              </span>
              <em>{{ t.description }}</em>
              <span v-if="isToolDisabled(t.name)" class="chip lock">
                Bundled in {{ humanize(bundlingAction(t.name) ?? '') }}
              </span>
            </span>
          </label>
        </div>
      </section>

      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'env'">← Back</button>
        <div class="nav-end">
          <span class="nav-note">Step 2 of 3</span>
          <button
            type="button"
            class="btn primary"
            data-testid="create-configure-continue"
            @click="phase = 'oasf'"
          >
            Next →
          </button>
        </div>
      </div>
    </div>

    <!-- OASF domains & skills (step 3) -->
    <div v-else-if="phase === 'oasf'" ref="bodyRef" class="body">
      <div class="panel-head">
          <div>
            <p class="section-title">Skills &amp; taxonomy <span class="optional">optional</span></p>
            <p class="hint">
              Stored in the agent metadata so others can discover it.
              <a :href="oasfSchemaUrl" target="_blank" rel="noopener noreferrer">OASF schema ↗</a>
            </p>
          </div>
          <span class="count-pill">{{ selectedOasfSkills.length }} skills</span>
        </div>
        <label class="field search-field">
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </span>
          <input
            v-model="oasfSearch"
            type="text"
            placeholder="Search domains & skills…"
            spellcheck="false"
            data-testid="create-oasf-search"
          />
        </label>
        <p v-if="oasfLoading" class="hint" data-testid="create-oasf-loading">Loading OASF taxonomy…</p>
        <p v-else-if="oasfError" class="banner" data-testid="create-oasf-error">
          {{ oasfError }}
          <button type="button" class="btn ghost" @click="loadOasf">Retry</button>
        </p>
        <div v-else class="oasf-grid">
          <div class="oasf-col">
            <p class="group-label">Domains</p>
            <ul class="domain-list">
              <li v-for="d in visibleDomains" :key="`oasf-domain-${d.id}`">
                <label class="domain-chip" :class="{ partial: domainSkillState(d.id) === 'some' }">
                  <input
                    type="checkbox"
                    :data-testid="`create-oasf-domain-${d.id}`"
                    :checked="domainSkillState(d.id) !== 'none'"
                    :indeterminate="domainSkillState(d.id) === 'some'"
                    @change="toggleOasfDomain(d.id)"
                  />
                  <span class="domain-name">{{ d.name }}</span>
                  <span class="domain-count">{{ d.skills.length }}</span>
                </label>
              </li>
            </ul>
            <p v-if="!visibleDomains.length" class="hint">No domains match your search.</p>
          </div>
          <div class="oasf-col">
            <p class="group-label">Skills <span>{{ selectedOasfSkills.length }} selected</span></p>
            <ul class="skill-list">
              <li v-for="s in visibleSkills" :key="`oasf-skill-${s.id}`">
                <label class="skill-chip">
                  <input
                    type="checkbox"
                    :data-testid="`create-oasf-skill-${s.id}`"
                    :checked="selectedOasfSkills.includes(s.id)"
                    @change="toggleOasfSkill(s.id)"
                  />
                  <span class="skill-body">
                    <strong>{{ s.name }}</strong>
                    <em>{{ s.domainName }}</em>
                  </span>
                </label>
              </li>
            </ul>
            <p v-if="!visibleSkills.length" class="hint">No skills match your search.</p>
          </div>
        </div>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'configure'">← Back</button>
        <div class="nav-end">
          <span class="nav-note">Step 3 of 3</span>
          <button
            type="button"
            class="btn primary"
            data-testid="create-agent-submit"
            :disabled="busy || !connectedAddress"
            @click="submitCreate"
          >
            Create agent
          </button>
        </div>
      </div>
    </div>

    <!-- Creating -->
    <div v-else-if="phase === 'creating'" ref="bodyRef" class="body body-center">
      <div class="creating">
        <span class="spinner" aria-hidden="true"></span>
        <p class="creating-title">Creating “{{ agentName }}”</p>
        <p class="hint">Wallet · config · on-chain registration</p>
      </div>
    </div>

    <!-- Done — identity issued, then guided funding + chat -->
    <CreateAgentDone
      v-else-if="phase === 'done' && createdAgent"
      :agent="createdAgent"
      :balance="createdBalance"
      :image-url="imagePreviewUrl"
      :private-key="createdPrivateKey"
      :private-key-env-var="createdPrivateKeyEnvVar"
      :ephemeral-warning="createdEphemeralWarning"
      @open-chat="openChat"
      @close="emit('cancel')"
    />

    <!-- Error -->
    <div v-else-if="phase === 'error'" ref="bodyRef" class="body">
      <p class="section-title">Creation failed</p>
      <p class="banner">{{ createError }}</p>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'oasf'">← Back</button>
        <button type="button" class="btn primary" @click="submitCreate">Retry</button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./create-agent.css"></style>
