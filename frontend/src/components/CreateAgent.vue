<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { sendTransaction } from '@wagmi/vue/actions'
import { parseEther } from 'viem'
import {
  createAgent,
  fetchCatalog,
  fundAgent,
  scanUrlForAgent,
  uploadImage,
  type AgentSummary,
  type CatalogResponse,
  type CreateAgentStep,
} from '../api'
import { config as wagmiConfig } from '../wagmi'
import { ensureArbitrumSepolia } from '../chain'

import { OASF_SCHEMA_URL, fetchOasfDomains, type OasfDomain } from '../oasf'

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

const phase = ref<Phase>('env')
const catalog = ref<CatalogResponse | null>(null)
const loadError = ref('')
const createError = ref('')
const busy = ref(false)

const agentName = ref('')
const agentDescription = ref('')
const selectedActions = ref<string[]>([])
const selectedTools = ref<string[]>([])
const selectedOasfSkills = ref<string[]>([])
const oasfSearch = ref('')
const oasfSchemaUrl = OASF_SCHEMA_URL
const fundEth = ref('0.002')
const fundBusy = ref<'master' | 'wallet' | null>(null)
const fundStatus = ref('')
const fundStatusKind = ref<'info' | 'ok' | 'error'>('info')
const fundTxHash = ref('')
const webEndpoint = ref('https://example.com')
const emailEndpoint = ref('e@mail.fun')
const mcpEndpoint = ref(
  typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '',
)

const hasSelectedCapabilities = computed(
  () => selectedActions.value.length > 0 || selectedTools.value.length > 0,
)
const mcpMissingWarning = computed(
  () => hasSelectedCapabilities.value && !mcpEndpoint.value.trim(),
)

// Optional agent image (step 1): chosen via file picker or drag & drop,
// kept locally for preview and uploaded to IPFS at creation time,
// just before the agent metadata is pinned.
const imageFile = ref<File | null>(null)
const imagePreviewUrl = ref('')
const imageUri = ref('')
const imageStatus = ref<'idle' | 'uploading' | 'done' | 'error'>('idle')
const imageError = ref('')
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

function pickImage() {
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) selectImage(file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) selectImage(file)
}

function selectImage(file: File) {
  imageError.value = ''
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    imageStatus.value = 'error'
    imageError.value = 'Unsupported image type — use PNG, JPEG, GIF, WebP or SVG'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    imageStatus.value = 'error'
    imageError.value = 'Image is too large — max 5 MB'
    return
  }
  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
  imageFile.value = file
  imagePreviewUrl.value = URL.createObjectURL(file)
  imageUri.value = ''
  imageStatus.value = 'idle'
}

function removeImage() {
  if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
  imageFile.value = null
  imagePreviewUrl.value = ''
  imageUri.value = ''
  imageStatus.value = 'idle'
  imageError.value = ''
}

const createSteps = ref<CreateAgentStep[]>([])
const createdAgent = ref<AgentSummary | null>(null)
const createdBalance = ref('')
const createdPrivateKey = ref('')
const createdPrivateKeyEnvVar = ref('')
const createdEphemeralWarning = ref('')
const privateKeyVisible = ref(false)
const privateKeyCopied = ref(false)

const createdWalletScanUrl = computed(() => {
  const address = createdAgent.value?.walletAddress
  if (!address) return null
  const chainId = createdAgent.value?.walletChainId ?? 421614
  const base = chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/address/${address}`
})

const createdScanId = computed(() => {
  const agentId = createdAgent.value?.agentId
  if (!agentId) return null
  const parts = agentId.split(':')
  return parts[parts.length - 1] || agentId
})

const createdScanUrl = computed(() => {
  const agentId = createdAgent.value?.agentId
  if (!agentId) return null
  return scanUrlForAgent(agentId, createdAgent.value?.walletChainId ?? 421614)
})

const nameValid = computed(() =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(agentName.value.trim()),
)

const fundAmountValid = computed(() => {
  const n = Number(fundEth.value)
  return Number.isFinite(n) && n > 0 && n <= 1
})

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

async function loadCatalog() {
  loadError.value = ''
  try {
    catalog.value = await fetchCatalog()
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : 'Failed to load catalog — is the API running?'
  }
}

onMounted(() => {
  void loadCatalog()
  void loadOasf()
})

// Mutual exclusivity: transfer-eth bundles send_eth + get_token_balance
const TRANSFER_ETH_TOOLS = ['send_eth', 'get_token_balance'] as const
const TRANSFER_ETH_ACTION = 'transfer-eth'

function isToolPale(name: string): boolean {
  return (TRANSFER_ETH_TOOLS as readonly string[]).includes(name) && selectedActions.value.includes(TRANSFER_ETH_ACTION)
}

function isActionPale(name: string): boolean {
  if (name !== TRANSFER_ETH_ACTION) return false
  // Pale when both constituent tools are selected as standalone (group-level exclusivity)
  // Also pale when any single constituent is selected — keeps visual cue symmetric
  // Choose ANY to give earlier feedback; switch to .every if strict group exclusivity is desired
  return TRANSFER_ETH_TOOLS.some((t) => selectedTools.value.includes(t))
}

function toggleAction(name: string) {
  const i = selectedActions.value.indexOf(name)
  const isSelected = i >= 0
  if (isSelected) {
    selectedActions.value.splice(i, 1)
  } else {
    // Selecting transfer-eth deselects its constituent standalone tools
    if (name === TRANSFER_ETH_ACTION) {
      selectedTools.value = selectedTools.value.filter((t) => !(TRANSFER_ETH_TOOLS as readonly string[]).includes(t))
    }
    selectedActions.value.push(name)
  }
}

function toggleTool(name: string) {
  const isTransferTool = (TRANSFER_ETH_TOOLS as readonly string[]).includes(name)
  const transferActionSelected = selectedActions.value.includes(TRANSFER_ETH_ACTION)

  // Selecting a constituent tool deselects the transfer-eth action (vice versa)
  if (isTransferTool && transferActionSelected) {
    const idx = selectedActions.value.indexOf(TRANSFER_ETH_ACTION)
    if (idx >= 0) selectedActions.value.splice(idx, 1)
  }

  const i = selectedTools.value.indexOf(name)
  if (i >= 0) selectedTools.value.splice(i, 1)
  else selectedTools.value.push(name)

  // If both constituent tools are now individually selected, ensure action stays deselected
  if (isTransferTool && selectedTools.value.includes('send_eth') && selectedTools.value.includes('get_token_balance')) {
    const ai = selectedActions.value.indexOf(TRANSFER_ETH_ACTION)
    if (ai >= 0) selectedActions.value.splice(ai, 1)
  }
}

function goConfigure() {
  if (!nameValid.value) return
  phase.value = 'configure'
}

async function submitCreate() {
  if (busy.value) return
  phase.value = 'creating'
  createError.value = ''
  createSteps.value = []
  createdAgent.value = null
  createdPrivateKey.value = ''
  createdPrivateKeyEnvVar.value = ''
  createdEphemeralWarning.value = ''
  privateKeyVisible.value = false
  privateKeyCopied.value = false
  fundStatus.value = ''
  fundTxHash.value = ''
  busy.value = true

  try {
    // Upload the image now (if one was picked and not yet uploaded),
    // just before the agent metadata is pinned during creation.
    let imageUriToSend = imageUri.value || undefined
    if (imageFile.value && !imageUriToSend) {
      imageStatus.value = 'uploading'
      try {
        const res = await uploadImage(imageFile.value)
        imageUri.value = res.imageUri
        imageUriToSend = res.imageUri
        imageStatus.value = 'done'
      } catch (err) {
        imageStatus.value = 'error'
        imageError.value = err instanceof Error ? err.message : 'Image upload failed'
        throw err
      }
    }

    const services = [
      { name: 'web', endpoint: webEndpoint.value.trim() },
      { name: 'email', endpoint: emailEndpoint.value.trim() },
      { name: 'mcp', endpoint: mcpEndpoint.value.trim() },
    ].filter((s) => s.endpoint.length > 0)

    const res = await createAgent({
      name: agentName.value.trim(),
      description: agentDescription.value.trim() || undefined,
      imageUri: imageUriToSend,
      actions: selectedActions.value,
      tools: selectedTools.value,
      oasfDomains: selectedOasfDomains.value,
      oasfSkills: selectedOasfSkills.value,
      services,
    })
    createSteps.value = res.steps
    createdAgent.value = res.agent
    createdBalance.value = res.balanceEth
    createdPrivateKey.value = res.privateKey ?? ''
    createdPrivateKeyEnvVar.value = res.privateKeyEnvVar ?? ''
    createdEphemeralWarning.value = res.ephemeralWarning ?? ''
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

async function copyPrivateKey() {
  if (!createdPrivateKey.value) return
  try {
    await navigator.clipboard.writeText(createdPrivateKey.value)
    privateKeyCopied.value = true
    setTimeout(() => (privateKeyCopied.value = false), 2000)
  } catch {
    // Clipboard API unavailable (non-secure context) — user can select manually.
    privateKeyCopied.value = false
  }
}

function bumpBalance(amountEth: string) {
  const cur = Number(createdBalance.value || '0')
  const add = Number(amountEth)
  if (Number.isFinite(cur) && Number.isFinite(add)) {
    createdBalance.value = String(+(cur + add).toFixed(6))
  }
}

/** Fund the freshly created agent from the server master wallet. */
async function fundFromMaster() {
  if (!createdAgent.value || !fundAmountValid.value || fundBusy.value) return
  fundBusy.value = 'master'
  fundStatusKind.value = 'info'
  fundStatus.value = 'Sending from master wallet…'
  try {
    const res = await fundAgent(createdAgent.value.name, fundEth.value.trim())
    fundTxHash.value = res.txHash
    fundStatusKind.value = 'ok'
    fundStatus.value = `Sent ${res.amountEth} ETH (tx ${res.txHash.slice(0, 10)}…)`
    bumpBalance(res.amountEth)
  } catch (err) {
    fundStatusKind.value = 'error'
    fundStatus.value = err instanceof Error ? err.message : String(err)
  } finally {
    fundBusy.value = null
  }
}

/** Fund the freshly created agent from the user's connected wallet (MetaMask signs). */
async function fundFromWallet() {
  if (!createdAgent.value?.walletAddress || !fundAmountValid.value || fundBusy.value) return
  fundBusy.value = 'wallet'
  fundStatusKind.value = 'info'
  fundStatus.value = 'Waiting for wallet signature…'
  try {
    await ensureArbitrumSepolia()
    const hash = await sendTransaction(wagmiConfig, {
      to: createdAgent.value.walletAddress as `0x${string}`,
      value: parseEther(fundEth.value.trim() as `${number}`),
    })
    fundTxHash.value = hash
    fundStatusKind.value = 'ok'
    fundStatus.value = `Sent ${fundEth.value.trim()} ETH (tx ${hash.slice(0, 10)}…)`
    bumpBalance(fundEth.value.trim())
  } catch (err) {
    fundStatusKind.value = 'error'
    fundStatus.value = err instanceof Error ? (err.message.split('\n')[0] || err.message) : String(err)
  } finally {
    fundBusy.value = null
  }
}
</script>

<template>
  <section class="wizard" data-testid="create-dialog">
    <header class="head">
      <h2>Create agent</h2>
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

    <p v-if="loadError" class="banner" data-testid="create-load-error">{{ loadError }}</p>

    <!-- Environment + name (merged first step) -->
    <div v-else-if="phase === 'env'" class="body">
      <p class="step-label">Environment</p>
      <dl v-if="catalog" class="env">
        <div>
          <dt>Network</dt>
          <dd>{{ catalog.networkName }} ({{ catalog.network }})</dd>
        </div>
        <div>
          <dt>Master Wallet</dt>
          <dd class="mono">{{ catalog.master.address }}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ catalog.master.balanceEth ?? '—' }} ETH</dd>
        </div>
      </dl>
      <p v-else class="hint">Loading environment…</p>
      <p class="step-label">Agent name</p>
      <label class="field">
        <input
          v-model="agentName"
          type="text"
          placeholder="my-agent"
          spellcheck="false"
          autofocus
          data-testid="create-name-input"
          @keydown.enter.prevent="goConfigure"
        />
      </label>
      <p class="hint">Letters, numbers, . _ - (1–63 chars)</p>
      <p class="step-label">Description <span class="optional">(optional)</span></p>
      <label class="field">
        <textarea
          v-model="agentDescription"
          rows="3"
          placeholder="What does this agent do?"
          data-testid="create-description-input"
        ></textarea>
      </label>
      <p class="step-label">Services</p>
      <label class="field">
        <span>Web endpoint</span>
        <input
          v-model="webEndpoint"
          type="text"
          placeholder="https://example.com"
          spellcheck="false"
          data-testid="create-web-endpoint"
        />
      </label>
      <label class="field">
        <span>Email endpoint</span>
        <input
          v-model="emailEndpoint"
          type="text"
          placeholder="e@mail.fun"
          spellcheck="false"
          data-testid="create-email-endpoint"
        />
      </label>
      <label class="field">
        <span>MCP endpoint <span class="optional">(optional — advertises tools on 8004scan)</span></span>
        <input
          v-model="mcpEndpoint"
          type="text"
          placeholder="https://your-host/api/mcp"
          spellcheck="false"
          data-testid="create-mcp-endpoint"
        />
      </label>
      <p v-if="mcpMissingWarning" class="hint" data-testid="create-mcp-warning">
        You selected actions/tools but no MCP endpoint — they will run locally in chat only,
        not appear under Services → MCP on 8004scan. Add an https://…/api/mcp URL to advertise them.
      </p>
      <p class="step-label">Image <span class="optional">(optional)</span></p>
      <div
        v-if="!imageFile"
        class="dropzone"
        :class="{ dragging }"
        data-testid="create-image-dropzone"
        role="button"
        tabindex="0"
        aria-label="Add agent image"
        @click="pickImage"
        @keydown.enter.prevent="pickImage"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span class="dropzone-icon">🖼️</span>
        <span class="dropzone-text">
          Drag &amp; drop an image here, or <strong>browse files</strong>
        </span>
        <span class="dropzone-hint">PNG, JPEG, GIF, WebP or SVG · max 5 MB</span>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          class="visually-hidden"
          data-testid="create-image-input"
          @change="onFileChosen"
        />
      </div>
      <template v-if="imageFile">
        <div class="image-preview" data-testid="create-image-preview">
          <img :src="imagePreviewUrl" alt="Agent image preview" />
          <div class="image-meta">
            <strong class="image-name">{{ imageFile.name }}</strong>
            <span v-if="imageStatus === 'uploading'" class="image-status" data-testid="create-image-uploading">
              Uploading to IPFS…
            </span>
            <span v-else-if="imageStatus === 'error'" class="image-status fail" data-testid="create-image-error">
              {{ imageError }}
            </span>
            <span v-else class="image-status" data-testid="create-image-ready">
              Ready — uploads when you create the agent
            </span>
          </div>
          <button
            type="button"
            class="btn ghost small icon-btn"
            aria-label="Remove image"
            title="Remove image"
            data-testid="create-image-remove"
            @click.stop="removeImage"
          >
            ✕
          </button>
        </div>
      </template>
      <p v-else-if="imageStatus === 'error' && imageError" class="image-status fail" data-testid="create-image-error">
        {{ imageError }}
      </p>
      <div class="nav">
        <button
          type="button"
          class="btn primary"
          data-testid="create-name-continue"
          :disabled="!catalog || !nameValid"
          @click="goConfigure"
        >
          Next →
        </button>
      </div>
    </div>

    <!-- Configure (step 2) — flat tools & actions -->
    <div v-else-if="phase === 'configure'" class="body">
      <p class="step-label">Configure your agent — tools &amp; actions</p>
      <p class="hint">
        Selected tools run locally in chat. To advertise them over MCP on 8004scan
        (Services → MCP), set the MCP endpoint in step 1.
      </p>
      <p v-if="mcpMissingWarning" class="hint" data-testid="create-mcp-warning-configure">
        No MCP endpoint set — your selection won't appear on 8004scan. Go back to step 1
        and add an https://…/api/mcp URL.
      </p>
      <ul class="checklist">
        <!-- Actions -->
        <li v-for="a in catalog?.actions ?? []" :key="`action-${a.name}`">
          <label class="check" :class="{ pale: isActionPale(a.name) }">
            <input
              type="checkbox"
              :data-testid="`create-action-${a.name}`"
              :checked="selectedActions.includes(a.name)"
              @change="toggleAction(a.name)"
            />
            <span>
              <strong>{{ a.name }} <span class="badge">action</span></strong>
              <em>{{ a.description }} [tools: {{ a.toolNames.join(', ') }}]<template v-if="a.name === 'transfer-eth'"> · Mutually exclusive with send_eth + get_token_balance standalone tools.</template></em>
            </span>
          </label>
        </li>
        <!-- Standalone tools -->
        <li v-for="t in catalog?.tools ?? []" :key="`tool-${t.name}`">
          <label class="check" :class="{ pale: isToolPale(t.name) }">
            <input
              type="checkbox"
              :data-testid="`create-tool-${t.name}`"
              :checked="selectedTools.includes(t.name)"
              @change="toggleTool(t.name)"
            />
            <span>
              <strong>{{ t.name }} <span class="badge tool">tool</span></strong>
              <em>{{ t.description }}<template v-if="t.name === 'send_eth' || t.name === 'get_token_balance'"> · Mutually exclusive with transfer-eth action.</template></em>
            </span>
          </label>
        </li>
      </ul>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'env'">← Back</button>
        <button type="button" class="btn primary" data-testid="create-configure-continue" @click="phase = 'oasf'">Next →</button>
      </div>
    </div>

    <!-- OASF domains & skills (step 3) -->
    <div v-else-if="phase === 'oasf'" class="body">
      <p class="step-label">Capabilities — OASF domains &amp; skills <span class="optional">(optional)</span></p>
      <p class="hint">
        Pick domains, then skills. Stored on-chain in agent metadata.
        <a :href="oasfSchemaUrl" target="_blank" rel="noopener noreferrer">OASF schema ↗</a>
      </p>
      <label class="field">
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
          <p class="step-label">Skills <span class="optional">({{ selectedOasfSkills.length }} selected)</span></p>
          <ul class="checklist">
            <li v-for="s in visibleSkills" :key="`oasf-skill-${s.id}`">
              <label class="check">
                <input
                  type="checkbox"
                  :data-testid="`create-oasf-skill-${s.id}`"
                  :checked="selectedOasfSkills.includes(s.id)"
                  @change="toggleOasfSkill(s.id)"
                />
                <span>
                  <strong>{{ s.name }} <span class="badge tool">[{{ s.id }}]</span></strong>
                  <em>{{ s.domainName }}</em>
                </span>
              </label>
            </li>
          </ul>
          <p v-if="!visibleSkills.length" class="hint">No skills match your search.</p>
        </div>
        <div class="oasf-col">
          <p class="step-label">Domains</p>
          <ul class="checklist domains">
            <li v-for="d in visibleDomains" :key="`oasf-domain-${d.id}`">
              <label class="check" :class="{ partial: domainSkillState(d.id) === 'some' }">
                <input
                  type="checkbox"
                  :data-testid="`create-oasf-domain-${d.id}`"
                  :checked="domainSkillState(d.id) !== 'none'"
                  :indeterminate="domainSkillState(d.id) === 'some'"
                  @change="toggleOasfDomain(d.id)"
                />
                <span>
                  <strong>{{ d.name }} <span class="badge">[{{ d.id }}]</span></strong>
                  <em>{{ d.skills.length }} skills</em>
                </span>
              </label>
            </li>
          </ul>
          <p v-if="!visibleDomains.length" class="hint">No domains match your search.</p>
        </div>
      </div>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'configure'">← Back</button>
        <button
          type="button"
          class="btn primary"
          data-testid="create-agent-submit"
          :disabled="busy"
          @click="submitCreate"
        >
          Create agent
        </button>
      </div>
    </div>

    <!-- Creating -->
    <div v-else-if="phase === 'creating'" class="body">
      <p class="step-label">Creating “{{ agentName }}”…</p>
      <p class="hint creating-pulse">Image → wallet → config → register</p>
    </div>

    <!-- Done -->
    <div v-else-if="phase === 'done' && createdAgent" class="body">
      <p class="step-label">Agent created</p>
      <div
        v-if="createdPrivateKey"
        class="ephemeral-key"
        data-testid="create-ephemeral-key"
      >
        <p class="ephemeral-title">⚠️ Save this private key now — shown only once</p>
        <p v-if="createdEphemeralWarning" class="hint">{{ createdEphemeralWarning }}</p>
        <p v-if="createdPrivateKeyEnvVar" class="hint mono">
          Vercel → Settings → Environment Variables: {{ createdPrivateKeyEnvVar }}
        </p>
        <div class="key-row">
          <code class="mono key-value" data-testid="create-private-key-value">{{
            privateKeyVisible ? createdPrivateKey : '•'.repeat(48)
          }}</code>
          <button
            type="button"
            class="btn ghost small"
            @click="privateKeyVisible = !privateKeyVisible"
          >
            {{ privateKeyVisible ? 'Hide' : 'Show' }}
          </button>
          <button
            type="button"
            class="btn ghost small"
            data-testid="create-private-key-copy"
            @click="copyPrivateKey"
          >
            {{ privateKeyCopied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
      </div>
      <dl class="env">
        <div>
          <dt>Name</dt>
          <dd>{{ createdAgent.name }}</dd>
        </div>
        <div v-if="createdAgent.agentId">
          <dt>Agent ID</dt>
          <dd class="mono">
            <a
              v-if="createdScanUrl && createdScanId"
              :href="createdScanUrl"
              target="_blank"
              rel="noopener noreferrer"
              >#{{ createdScanId }} ↗</a
            >
            <span v-else>#{{ createdAgent.agentId }}</span>
          </dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd class="mono">
            <a
              v-if="createdWalletScanUrl"
              :href="createdWalletScanUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ createdAgent.walletAddress }} ↗</a
            >
            <span v-else>{{ createdAgent.walletAddress }}</span>
          </dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ createdBalance }} ETH</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{{ createdAgent.actions.join(', ') || 'none' }}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{{ createdAgent.tools.join(', ') || 'none' }}</dd>
        </div>
        <div v-if="(createdAgent.oasfDomains ?? []).length || (createdAgent.oasfSkills ?? []).length">
          <dt>OASF</dt>
          <dd>domains: {{ (createdAgent.oasfDomains ?? []).map(oasfDomainSlug).join(', ') || '—' }} · skills: {{ (createdAgent.oasfSkills ?? []).join(', ') || '—' }}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{{ createdAgent.active ? 'Active' : 'Inactive' }}</dd>
        </div>
        <div v-if="(createdAgent.services ?? []).length">
          <dt>Services</dt>
          <dd class="mono">{{ createdAgent.services!.map((s) => `${s.name}: ${s.endpoint}`).join(', ') }}</dd>
        </div>
      </dl>
      <ul v-if="createSteps.length" class="steps">
        <li v-for="s in createSteps" :key="s.step" :class="{ fail: !s.ok }">
          <span class="mono">{{ s.step }}</span>
          — {{ s.ok ? 'ok' : 'failed' }}
          <template v-if="s.detail"> · {{ s.detail }}</template>
        </li>
      </ul>
      <div class="fund-panel" data-testid="create-fund-panel">
        <p class="step-label">Fund agent wallet <span class="optional">(optional)</span></p>
        <label class="field">
          <span>Amount (ETH)</span>
          <input
            v-model="fundEth"
            type="text"
            inputmode="decimal"
            placeholder="0.002"
            spellcheck="false"
            data-testid="create-fund-amount"
            :disabled="fundBusy !== null"
          />
        </label>
        <div class="fund-actions">
          <button
            type="button"
            class="btn ghost"
            data-testid="create-fund-master"
            :disabled="!fundAmountValid || fundBusy !== null"
            @click="fundFromMaster"
          >
            {{ fundBusy === 'master' ? 'Sending…' : 'Fund from Master wallet' }}
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="create-fund-wallet"
            :disabled="!fundAmountValid || fundBusy !== null"
            @click="fundFromWallet"
          >
            {{ fundBusy === 'wallet' ? 'Waiting…' : 'Fund from connected wallet' }}
          </button>
        </div>
        <p v-if="fundStatus" class="hint" :class="fundStatusKind" data-testid="create-fund-status">
          {{ fundStatus }}
        </p>
      </div>
      <div class="nav">
        <button type="button" class="btn ghost" @click="emit('cancel')">Close</button>
        <button type="button" class="btn primary" @click="openChat">Open chat</button>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="phase === 'error'" class="body">
      <p class="step-label">Creation failed</p>
      <p class="banner">{{ createError }}</p>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'oasf'">← Back</button>
        <button type="button" class="btn primary" @click="submitCreate">Retry</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wizard {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--border);
}

.head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.1rem 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.step-label {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.env {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.env dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.env dd {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  word-break: break-all;
}

.env dd a {
  color: var(--accent);
  text-decoration: none;
}

.env dd a:hover {
  text-decoration: underline;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.field input {
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}

.field input:focus {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.field textarea {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  resize: vertical;
  min-height: 3.5rem;
}

.field textarea:focus {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.optional {
  text-transform: none;
  letter-spacing: 0;
  color: var(--muted);
  opacity: 0.75;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 1rem 0.85rem;
  border: 1.5px dashed var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
  background: color-mix(in oklab, var(--accent) 8%, var(--bg));
}

.dropzone:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.dropzone-icon {
  font-size: 1.3rem;
}

.dropzone-text {
  font-size: 0.82rem;
  color: var(--ink);
}

.dropzone-text strong {
  color: var(--accent);
}

.dropzone-hint {
  font-size: 0.72rem;
  color: var(--muted);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.image-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
}

.image-preview img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 0.4rem;
  flex-shrink: 0;
}

.image-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.image-name {
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-status {
  font-size: 0.72rem;
  color: var(--muted);
  word-break: break-all;
}

.image-status.ok {
  color: var(--accent);
}

.image-status.fail {
  color: #ffb4b0;
}

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.hint.ok {
  color: #6ecf8e;
}

.hint.error {
  color: #ffb4b0;
}

.fund-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
}

.fund-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.menu {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  text-align: left;
  font: inherit;
  padding: 0.75rem 0.85rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.menu-item:hover {
  background: var(--surface-2);
  border-color: color-mix(in oklab, var(--accent) 35%, var(--border));
}

.menu-item.primary {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  background: color-mix(in oklab, var(--accent) 12%, var(--bg));
}

.menu-title {
  font-weight: 600;
  font-size: 0.92rem;
}

.menu-hint {
  font-size: 0.78rem;
  color: var(--muted);
}

.checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.oasf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

.oasf-col {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

@media (max-width: 640px) {
  .oasf-grid {
    grid-template-columns: 1fr;
  }
}

.check {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.65rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
}

.check.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.check.pale {
  opacity: 0.55;
  /* pale like disabled, but still interactive */
}

.check.partial {
  border-style: dashed;
}

.check strong {
  display: block;
  font-size: 0.88rem;
}

.check em {
  display: block;
  margin-top: 0.15rem;
  font-style: normal;
  font-size: 0.78rem;
  color: var(--muted);
}

.check input {
  margin-top: 0.2rem;
  accent-color: var(--accent);
}

.badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  background: color-mix(in oklab, var(--accent) 18%, transparent);
  color: var(--accent);
  vertical-align: middle;
}

.badge.tool {
  background: color-mix(in oklab, var(--muted) 14%, transparent);
  color: var(--muted);
}

.nav {
  position: sticky;
  bottom: -1.25rem;
  z-index: 1;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 0.6rem;
  margin-top: auto;
  margin-left: -1.15rem;
  margin-right: -1.15rem;
  margin-bottom: -1.25rem;
  padding: 0.9rem 1.15rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.nav > :only-child {
  margin-left: auto;
}

.nav .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.banner {
  margin: 0;
  padding: 0.65rem 1rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border-bottom: 1px solid var(--border);
}

.body .banner {
  border: 1px solid color-mix(in oklab, #c44 40%, var(--border));
  border-radius: 0.4rem;
  background: color-mix(in oklab, #c44 14%, var(--surface));
  color: #ffb4b0;
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.78rem;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ephemeral-key {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem;
  border: 1px solid color-mix(in oklab, #c44 45%, var(--border));
  border-radius: 0.5rem;
  background: color-mix(in oklab, #c44 12%, var(--surface));
}

.ephemeral-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: #ffb4b0;
}

.ephemeral-key .hint.mono {
  word-break: break-all;
}

.key-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.key-value {
  flex: 1;
  min-width: 0;
  font-size: 0.75rem;
  word-break: break-all;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  background: var(--bg);
  color: var(--ink);
}

.steps .fail {
  color: #ffb4b0;
}

.creating-pulse {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}

.btn.small.icon-btn {
  padding: 0.35rem 0.55rem;
  font-size: 0.85rem;
  line-height: 1;
}
</style>
