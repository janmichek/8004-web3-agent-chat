<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { getAccount, getBalance, sendTransaction, waitForTransactionReceipt } from '@wagmi/vue/actions'
import { useConfig } from '@wagmi/vue'
import { parseEther } from 'viem'
import {
  createAgent,
  fetchCatalog,
  fundAgent,
  saveAgentBackup,
  scanUrlForAgent,
  uploadImage,
  type AgentSummary,
  type CatalogNetwork,
  type CatalogResponse,
  type CreateAgentStep,
} from '../api'
import { ensureChain, prepareNativeTransfer } from '../chain'
import { DEFAULT_CHAIN_ID, addressExplorerUrl, networkInfo, txExplorerUrl } from '../networks'
import { friendlyFundError } from '../rpc-errors'

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

const wagmiConfig = useConfig()
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
const selectedNetwork = computed(() => networks.value.find((n) => n.chainId === selectedChainId.value))
const createError = ref('')
const busy = ref(false)

const STEPS = [
  { key: 'env', label: 'Identity' },
  { key: 'configure', label: 'Abilities' },
  { key: 'oasf', label: 'Skills' },
] as const
const stepIndex = computed(() => STEPS.findIndex((s) => s.key === phase.value))
const isStepPhase = computed(() => stepIndex.value >= 0)
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
      return 'Three quick steps — most details are already filled in.'
    case 'configure':
      return 'Toggle what it can do. Anything here can be changed later.'
    case 'oasf':
      return 'Optional discovery tags so other agents can find yours.'
    default:
      return ''
  }
})
const activeServiceCount = computed(
  () =>
    [webEndpoint.value, emailEndpoint.value, mcpEndpoint.value, a2aEndpoint.value].filter(
      (endpoint) => endpoint.trim().length > 0,
    ).length,
)

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

function isLink(endpoint: string): boolean {
  return /^https?:\/\//i.test(endpoint)
}

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
  return addressExplorerUrl(address, createdAgent.value?.walletChainId)
})

const fundTxUrl = computed(() =>
  fundTxHash.value
    ? txExplorerUrl(fundTxHash.value, createdAgent.value?.walletChainId ?? selectedChainId.value)
    : '',
)

const createdNetworkName = computed(() => networkInfo(createdAgent.value?.walletChainId).name)

const createdScanId = computed(() => {
  const agentId = createdAgent.value?.agentId
  if (!agentId) return null
  const parts = agentId.split(':')
  return parts[parts.length - 1] || agentId
})

const createdScanUrl = computed(() => {
  const agentId = createdAgent.value?.agentId
  if (!agentId) return null
  return scanUrlForAgent(agentId, createdAgent.value?.walletChainId ?? DEFAULT_CHAIN_ID)
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
      { name: 'A2A', endpoint: a2aEndpoint.value.trim() },
    ].filter((s) => s.endpoint.length > 0)

    const res = await createAgent({
      name: agentName.value.trim(),
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
    createSteps.value = res.steps
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

const walletCopied = ref(false)
const idCopied = ref(false)

async function copyText(text: string | null | undefined, kind: 'wallet' | 'id') {
  if (!text) return
  const copied = kind === 'wallet' ? walletCopied : idCopied
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copied.value = false
  }
}

const createdInitials = computed(() => {
  const parts = (createdAgent.value?.name ?? '').split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (!parts.length) return 'AI'
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
})

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
  fundTxHash.value = ''
  try {
    const res = await fundAgent(createdAgent.value.name, fundEth.value.trim())
    fundTxHash.value = res.txHash
    fundStatusKind.value = 'ok'
    fundStatus.value = `Confirmed ${res.amountEth} ETH (tx ${res.txHash.slice(0, 10)}…)`
    bumpBalance(res.amountEth)
  } catch (err) {
    fundStatusKind.value = 'error'
    fundStatus.value = friendlyFundError(err, 'master', createdNetworkName.value)
  } finally {
    fundBusy.value = null
  }
}

/**
 * Wait until the funding tx is mined; throw if it reverts.
 * (Web3Auth used to send value transfers at 21_000 gas — Sepolia needs
 * ~200k to fund a fresh account — so we always pass estimateGas up front.)
 */
async function awaitFundSettlement(hash: `0x${string}`, chainId: number) {
  fundStatusKind.value = 'info'
  fundStatus.value = 'Submitted — waiting for confirmation…'
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
  if (receipt.status !== 'success') {
    throw new Error('Funding transaction reverted on-chain.')
  }
}

/** Fund the freshly created agent from the user's connected wallet (MetaMask signs). */
async function fundFromWallet() {
  if (!createdAgent.value?.walletAddress || !fundAmountValid.value || fundBusy.value) return
  fundBusy.value = 'wallet'
  fundStatusKind.value = 'info'
  fundStatus.value = 'Waiting for wallet signature…'
  fundTxHash.value = ''
  try {
    // The agent wallet is funded on the chain the agent was created on.
    const chainId = createdAgent.value.walletChainId ?? DEFAULT_CHAIN_ID
    await ensureChain(wagmiConfig, chainId)
    const account = getAccount(wagmiConfig)
    if (!account.address) throw new Error('Connect a wallet first')

    const amount = fundEth.value.trim()
    const value = parseEther(amount as `${number}`)
    const to = createdAgent.value.walletAddress as `0x${string}`

    fundStatus.value = 'Estimating gas…'
    const prepared = await prepareNativeTransfer({
      account: account.address,
      to,
      value,
      chainId,
    })
    const feeCap = prepared.maxFeePerGas ?? 0n
    const gasBudget = prepared.gas * feeCap
    const bal = await getBalance(wagmiConfig, { address: account.address, chainId })
    if (bal.value < value + gasBudget) {
      throw new Error('insufficient funds for gas')
    }

    // Playwright has no real wallet: let tests stub the send + settlement.
    const stub = (window as unknown as { __E2E_SEND_TX?: () => string | Promise<string> }).__E2E_SEND_TX
    fundStatus.value = 'Waiting for wallet signature…'
    const hash = stub
      ? ((await stub()) as `0x${string}`)
      : await sendTransaction(wagmiConfig, {
          account: account.address,
          to,
          value,
          chainId,
          gas: prepared.gas,
          maxFeePerGas: prepared.maxFeePerGas,
          maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
        })
    fundTxHash.value = hash
    if (!stub) {
      await awaitFundSettlement(hash, chainId)
    }
    fundStatusKind.value = 'ok'
    fundStatus.value = `Confirmed ${amount} ETH (tx ${hash.slice(0, 10)}…)`
    bumpBalance(amount)
  } catch (err) {
    fundStatusKind.value = 'error'
    fundStatus.value = friendlyFundError(err)
  } finally {
    fundBusy.value = null
  }
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
      <section class="panel">
        <div class="identity">
          <div class="avatar-col">
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
              <span class="dropzone-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="16"
                    rx="3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                  />
                  <circle cx="9" cy="10" r="1.6" fill="currentColor" />
                  <path
                    d="M4.5 17.5l4.6-4.6a1.5 1.5 0 012.1 0l2.1 2.1 2-2a1.5 1.5 0 012.1 0l2.1 2.1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
              <span class="dropzone-text"><strong>Add image</strong></span>
              <span class="dropzone-hint">PNG · JPG · SVG</span>
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                class="visually-hidden"
                data-testid="create-image-input"
                @change="onFileChosen"
              />
            </div>
            <div v-else class="image-preview" data-testid="create-image-preview">
              <img :src="imagePreviewUrl" alt="Agent image preview" />
              <div class="image-meta">
                <strong class="image-name">{{ imageFile.name }}</strong>
                <span
                  v-if="imageStatus === 'uploading'"
                  class="image-status"
                  data-testid="create-image-uploading"
                >
                  Uploading to IPFS…
                </span>
                <span
                  v-else-if="imageStatus === 'error'"
                  class="image-status fail"
                  data-testid="create-image-error"
                >
                  {{ imageError }}
                </span>
                <span v-else class="image-status" data-testid="create-image-ready">
                  Ready — uploads when you create the agent
                </span>
              </div>
              <button
                type="button"
                class="btn ghost small icon-btn image-remove"
                aria-label="Remove image"
                title="Remove image"
                data-testid="create-image-remove"
                @click.stop="removeImage"
              >
                ✕
              </button>
            </div>
            <p
              v-if="!imageFile && imageStatus === 'error' && imageError"
              class="image-status fail"
              data-testid="create-image-error"
            >
              {{ imageError }}
            </p>
          </div>

          <div class="identity-fields">
            <label class="field">
              <span>Agent name</span>
              <input
                v-model="agentName"
                type="text"
                class="input-lg"
                placeholder="my-agent"
                spellcheck="false"
                autofocus
                data-testid="create-name-input"
                @keydown.enter.prevent="goConfigure"
              />
            </label>
            <p class="hint">Letters, numbers, . _ - (1–63 chars)</p>
            <label class="field">
              <span>Description <span class="optional">optional</span></span>
              <textarea
                v-model="agentDescription"
                rows="3"
                placeholder="What does this agent do?"
                data-testid="create-description-input"
              ></textarea>
            </label>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="section-title">Network &amp; wallet</p>
            <p class="hint">The agent gets its own wallet on the network you pick.</p>
          </div>
        </div>
        <div v-if="catalog" class="detail-row">
          <label class="mini-card network-card">
            <span class="mini-label">Network</span>
            <select
              v-model.number="selectedChainId"
              class="network-select"
              aria-label="Network"
              data-testid="create-network"
              :disabled="networks.length < 2"
            >
              <option v-for="n in networks" :key="n.chainId" :value="n.chainId">
                {{ n.name }} ({{ n.network }})
              </option>
            </select>
          </label>
          <div class="mini-card wallet-card">
            <span class="mini-label">Funded by</span>
            <span class="mono wallet-addr">{{ catalog.master.address }}</span>
          </div>
          <div class="mini-card balance-card">
            <span class="mini-label">Available</span>
            <strong class="mono" data-testid="create-master-balance">
              {{ selectedNetwork?.masterBalanceEth ?? '—' }} ETH
            </strong>
          </div>
        </div>
        <p v-else class="hint">Loading environment…</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="section-title">Connections</p>
            <p class="hint">Where people and other agents can reach yours.</p>
          </div>
          <span class="count-pill">{{ activeServiceCount }} active</span>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>Web</span>
            <input
              v-model="webEndpoint"
              type="text"
              placeholder="https://example.com"
              spellcheck="false"
              data-testid="create-web-endpoint"
            />
          </label>
          <label class="field">
            <span>Email</span>
            <input
              v-model="emailEndpoint"
              type="text"
              placeholder="e@mail.fun"
              spellcheck="false"
              data-testid="create-email-endpoint"
            />
          </label>
          <label class="field field-wide">
            <span>MCP <span class="optional">tool discovery</span></span>
            <input
              v-model="mcpEndpoint"
              type="text"
              placeholder="https://your-host/api/mcp"
              spellcheck="false"
              data-testid="create-mcp-endpoint"
            />
          </label>
          <label class="field field-wide">
            <span>A2A <span class="optional">agent-to-agent</span></span>
            <input
              v-model="a2aEndpoint"
              type="text"
              placeholder="https://your-host/api/a2a"
              spellcheck="false"
              data-testid="create-a2a-endpoint"
            />
          </label>
        </div>
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
        <label class="check" :class="{ disabled: !hasA2a }">
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

      <div class="nav">
        <span class="nav-note">Step 1 of 3</span>
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
            :disabled="busy"
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

    <!-- Done -->
    <div v-else-if="phase === 'done' && createdAgent" ref="bodyRef" class="body">
      <div class="success-hero">
        <div class="confetti" aria-hidden="true">
          <i v-for="n in 18" :key="n"></i>
        </div>
        <div class="success-avatar" :class="{ 'with-image': !!imagePreviewUrl }">
          <img v-if="imagePreviewUrl" :src="imagePreviewUrl" alt="" />
          <span v-else class="avatar-initials">{{ createdInitials }}</span>
          <span class="avatar-check" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
        <span class="live-pill">
          <i aria-hidden="true"></i>
          Live on {{ createdNetworkName }}
        </span>
        <p class="success-title">Agent created</p>
        <p class="hint">“{{ createdAgent.name }}” is ready to chat, work and earn.</p>
        <div class="hero-chips">
          <span v-if="createdScanId" class="chip">#{{ createdScanId }}</span>
          <span class="chip">{{ createdBalance }} ETH</span>
          <span class="chip">{{ createdAgent.active ? 'Active' : 'Inactive' }}</span>
          <span v-if="createdAgent.x402support" class="chip">x402</span>
        </div>
        <div class="hero-actions">
          <button
            type="button"
            class="hero-action"
            data-testid="create-copy-wallet"
            @click="copyText(createdAgent.walletAddress, 'wallet')"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect
                x="5.5"
                y="5.5"
                width="8"
                height="8"
                rx="1.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
              />
              <path
                d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            {{ walletCopied ? 'Wallet copied' : 'Copy wallet' }}
          </button>
          <button
            v-if="createdScanId"
            type="button"
            class="hero-action"
            @click="copyText(createdScanId, 'id')"
          >
            {{ idCopied ? 'ID copied' : `Copy #${createdScanId}` }}
          </button>
        </div>
      </div>

      <div v-if="createdPrivateKey" class="ephemeral-key" data-testid="create-ephemeral-key">
        <p class="ephemeral-title">Save this private key now — shown only once</p>
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

      <div class="detail-grid">
        <div class="mini-card">
          <span class="mini-label">Name</span>
          <strong>{{ createdAgent.name }}</strong>
        </div>
        <div class="mini-card" data-testid="create-done-network">
          <span class="mini-label">Network</span>
          <strong>{{ createdNetworkName }}</strong>
        </div>
        <div v-if="createdAgent.agentId" class="mini-card">
          <span class="mini-label">Agent ID</span>
          <a
            v-if="createdScanUrl && createdScanId"
            :href="createdScanUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mono"
            >#{{ createdScanId }} ↗</a
          >
          <span v-else class="mono">#{{ createdAgent.agentId }}</span>
        </div>
        <div class="mini-card mini-card-wide">
          <span class="mini-label">Wallet</span>
          <a
            v-if="createdWalletScanUrl"
            :href="createdWalletScanUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mono wallet-addr"
            >{{ createdAgent.walletAddress }} ↗</a
          >
          <span v-else class="mono wallet-addr">{{ createdAgent.walletAddress }}</span>
        </div>
        <div class="mini-card">
          <span class="mini-label">Balance</span>
          <strong class="mono">{{ createdBalance }} ETH</strong>
        </div>
        <div v-if="createdAgent.x402support" class="mini-card" data-testid="create-done-x402">
          <span class="mini-label">x402</span>
          <strong>
            {{
              createdAgent.x402Mode === 'facilitator'
                ? 'On — 0.01 USDC per request'
                : 'On — simulated'
            }}
          </strong>
        </div>
      </div>

      <div class="ability-group">
        <p class="group-label">Actions <span>{{ createdAgent.actions.length }}</span></p>
        <div class="chips">
          <span v-for="a in createdAgent.actions" :key="a" class="chip">{{ humanize(a) }}</span>
          <span v-if="!createdAgent.actions.length" class="chip muted">none</span>
        </div>
      </div>
      <div class="ability-group">
        <p class="group-label">Tools <span>{{ createdAgent.tools.length }}</span></p>
        <div class="chips">
          <span v-for="t in createdAgent.tools" :key="t" class="chip">{{ humanize(t) }}</span>
          <span v-if="!createdAgent.tools.length" class="chip muted">none</span>
        </div>
      </div>
      <div
        v-if="(createdAgent.oasfDomains ?? []).length || (createdAgent.oasfSkills ?? []).length"
        class="ability-group"
      >
        <p class="group-label">OASF</p>
        <div class="chips">
          <span v-for="d in createdAgent.oasfDomains ?? []" :key="d" class="chip">
            {{ oasfDomainSlug(d) }}
          </span>
          <span v-for="s in createdAgent.oasfSkills ?? []" :key="s" class="chip muted">{{ s }}</span>
        </div>
      </div>

      <div
        v-if="(createdAgent.services ?? []).length"
        class="ability-group"
        data-testid="create-done-services"
      >
        <p class="group-label">Services</p>
        <ul class="service-list">
          <li v-for="s in createdAgent.services" :key="s.name">
            <span class="service-name">{{ s.name }}</span>
            <a
              v-if="isLink(s.endpoint)"
              :href="s.endpoint"
              target="_blank"
              rel="noopener noreferrer"
              class="mono"
              >{{ s.endpoint }} ↗</a
            >
            <span v-else class="mono">{{ s.endpoint }}</span>
          </li>
        </ul>
      </div>

      <ul v-if="createSteps.length" class="steps">
        <li v-for="s in createSteps" :key="s.step" :class="{ fail: !s.ok }">
          <span class="step-mark" :class="{ fail: !s.ok }"></span>
          <span class="mono">{{ s.step }}</span>
          <span class="step-status">{{ s.ok ? 'ok' : 'failed' }}</span>
          <template v-if="s.detail"> · {{ s.detail }}</template>
        </li>
      </ul>

      <ol class="next-steps">
        <li>
          <span class="ns-num">1</span>
          <span>
            <strong>Fund the wallet</strong>
            <em>Optional — so it can pay for transactions.</em>
          </span>
        </li>
        <li>
          <span class="ns-num">2</span>
          <span>
            <strong>Say hello</strong>
            <em>Open chat and give it a first job.</em>
          </span>
        </li>
        <li>
          <span class="ns-num">3</span>
          <span>
            <strong>Get rated</strong>
            <em>Feedback builds its on-chain reputation.</em>
          </span>
        </li>
      </ol>

      <div class="fund-panel" data-testid="create-fund-panel">
        <div class="panel-head">
          <div>
            <p class="section-title">Fund the agent wallet <span class="optional">optional</span></p>
            <p class="hint">Give it a little ETH so it can pay for transactions.</p>
          </div>
        </div>
        <div class="fund-presets">
          <button
            v-for="preset in ['0.001', '0.002', '0.005']"
            :key="preset"
            type="button"
            class="preset"
            :class="{ on: fundEth === preset }"
            :disabled="fundBusy !== null"
            @click="fundEth = preset"
          >
            {{ preset }} ETH
          </button>
        </div>
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
            {{
              fundBusy === 'wallet'
                ? fundTxHash
                  ? 'Confirming…'
                  : 'Waiting…'
                : 'Fund from connected wallet'
            }}
          </button>
        </div>
        <p v-if="fundStatus" class="hint" :class="fundStatusKind" data-testid="create-fund-status">
          {{ fundStatus }}
          <a
            v-if="fundTxUrl"
            :href="fundTxUrl"
            class="fund-tx-link"
            target="_blank"
            rel="noopener"
            data-testid="create-fund-tx-link"
          >View tx</a>
        </p>
      </div>

      <div class="nav">
        <button type="button" class="btn ghost" @click="emit('cancel')">Close</button>
        <button type="button" class="btn primary" @click="openChat">Open chat</button>
      </div>
    </div>

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

.network-select {
  font: inherit;
  color: var(--ink);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  padding: 0.3rem 0.5rem;
  max-width: 100%;
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
  color: var(--danger-ink);
}

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.hint.ok {
  color: var(--ok-ink);
}

.hint.error {
  color: var(--danger-ink);
}

.fund-tx-link {
  margin-left: 0.4rem;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
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
  border: 1px solid color-mix(in oklab, var(--danger-base) 40%, var(--border));
  border-radius: 0.4rem;
  background: color-mix(in oklab, var(--danger-base) 14%, var(--surface));
  color: var(--danger-ink);
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
  border: 1px solid color-mix(in oklab, var(--danger-base) 45%, var(--border));
  border-radius: 0.5rem;
  background: color-mix(in oklab, var(--danger-base) 12%, var(--surface));
}

.ephemeral-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--danger-ink);
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
  color: var(--danger-ink);
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

/* ---------- Refined creation flow ---------- */

.wizard {
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--surface) 92%, var(--accent)) 0%,
    var(--surface) 12rem
  );
}

.head {
  align-items: flex-start;
  padding: 1.2rem 1.35rem 0.75rem;
  border-bottom: none;
}

.head-copy {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.eyebrow {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.head h2 {
  font-size: 1.32rem;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.head-sub {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  max-width: 34rem;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 1.35rem 1rem;
}

.stepper-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1;
  min-width: 0;
}

.stepper-dot {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.stepper-dot svg {
  width: 0.8rem;
  height: 0.8rem;
}

.stepper-name {
  font-size: 0.74rem;
  color: var(--muted);
  white-space: nowrap;
}

.stepper-line {
  flex: 1;
  height: 1px;
  min-width: 0.5rem;
  background: var(--border);
  transition: background 0.2s ease;
}

.stepper-item.active .stepper-dot {
  color: var(--on-accent);
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 60%, #7b5cff));
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 16%, transparent);
}

.stepper-item.active .stepper-name {
  color: var(--ink);
  font-weight: 600;
}

.stepper-item.done .stepper-dot {
  color: var(--accent);
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  background: color-mix(in oklab, var(--accent) 12%, transparent);
}

.stepper-item.done .stepper-name {
  color: color-mix(in oklab, var(--ink) 75%, var(--muted));
}

.stepper-item.done .stepper-line {
  background: color-mix(in oklab, var(--accent) 45%, var(--border));
}

.body {
  padding: 0.35rem 1.35rem 1.35rem;
  gap: 0.9rem;
}

.body > * {
  flex-shrink: 0;
}

.body-center {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.8rem;
  background: color-mix(in oklab, var(--surface-2) 45%, transparent);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 600;
}

.count-pill {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 13%, transparent);
  border: 1px solid color-mix(in oklab, var(--accent) 26%, transparent);
  padding: 0.18rem 0.5rem;
  border-radius: 2rem;
  white-space: nowrap;
}

.identity {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 1.1rem;
  align-items: stretch;
}

.avatar-col {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

.dropzone {
  flex: 1;
  justify-content: center;
  gap: 0.3rem;
  min-height: 8.5rem;
  padding: 0.75rem 0.5rem;
  border-radius: 0.75rem;
}

.dropzone-icon {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  color: var(--accent);
}

.dropzone-icon svg {
  width: 100%;
  height: 100%;
}

.dropzone-text {
  font-size: 0.75rem;
}

.dropzone-text strong {
  display: block;
  font-size: 0.82rem;
  font-family: var(--font-display);
}

.dropzone-hint {
  font-size: 0.64rem;
  letter-spacing: 0.02em;
}

.image-preview {
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  padding: 0.4rem;
  border-radius: 0.75rem;
  position: relative;
}

.image-preview img {
  width: 100%;
  flex: 1;
  min-height: 6.2rem;
  border-radius: 0.55rem;
}

.image-preview .image-meta {
  padding: 0 0.2rem 0.15rem;
}

.image-preview .image-name {
  font-size: 0.72rem;
}

.image-remove {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  backdrop-filter: blur(4px);
}

.identity-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.field span:first-child {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.field input,
.field textarea {
  font-family: var(--font-body);
  font-size: 0.9rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--bg);
}

.field .input-lg {
  font-family: var(--font-display);
  font-size: 1.08rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 0.62rem 0.75rem;
}

.field .optional {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
  opacity: 0.7;
}

.hint {
  font-size: 0.76rem;
  line-height: 1.45;
}

.hint.subtle {
  opacity: 0.85;
}

.note {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 0.55rem;
  font-size: 0.76rem;
  line-height: 1.45;
}

.note.warn {
  color: var(--warn);
  background: color-mix(in oklab, var(--warn) 9%, transparent);
  border: 1px solid color-mix(in oklab, var(--warn) 32%, var(--border));
}

.detail-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.mini-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  background: var(--bg);
}

.mini-card-wide {
  flex-basis: 100%;
}

.mini-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.mini-card strong {
  font-size: 0.92rem;
}

.mini-card a {
  color: var(--accent);
  text-decoration: none;
}

.mini-card a:hover {
  text-decoration: underline;
}

.wallet-addr {
  font-size: 0.72rem;
  word-break: break-all;
}

.network-card .network-select {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink);
}

.network-card .network-select:focus {
  box-shadow: none;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

.field-wide {
  grid-column: 1 / -1;
}

.check {
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  border-radius: 0.6rem;
  background: var(--bg);
  transition: border-color 0.18s ease, background 0.18s ease;
}

.check:hover:not(.disabled) {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
}

.check input {
  width: 1rem;
  height: 1rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
}

.check strong {
  font-size: 0.82rem;
}

.check em {
  font-size: 0.72rem;
  line-height: 1.45;
}

.ability-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-label {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.group-label span {
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  opacity: 0.7;
}

.ability-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.ability {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  background: var(--bg);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease,
    transform 0.18s var(--ease-spring), box-shadow 0.18s ease;
}

.ability:hover:not(.disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
}

.ability.on {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
  background: color-mix(in oklab, var(--accent) 9%, var(--bg));
}

.ability.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ability input {
  appearance: none;
  -webkit-appearance: none;
  display: grid;
  place-content: center;
  width: 1.05rem;
  height: 1.05rem;
  margin: 0.1rem 0 0;
  flex-shrink: 0;
  border: 1.5px solid color-mix(in oklab, var(--muted) 55%, transparent);
  border-radius: 0.3rem;
  background: var(--surface);
  cursor: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ability input::after {
  content: '';
  width: 0.55rem;
  height: 0.3rem;
  margin-top: -0.12rem;
  border-left: 2px solid var(--on-accent);
  border-bottom: 2px solid var(--on-accent);
  transform: rotate(-45deg) scale(0);
  transition: transform 0.16s var(--ease-spring);
}

.ability input:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.ability input:checked::after {
  transform: rotate(-45deg) scale(1);
}

.ability input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.ability input:disabled {
  opacity: 0.7;
}

.ability-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.ability-top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.ability-top strong {
  font-size: 0.85rem;
}

.ability em {
  font-style: normal;
  font-size: 0.73rem;
  line-height: 1.4;
  color: var(--muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.15rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.66rem;
  padding: 0.1rem 0.4rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--surface-2) 75%, transparent);
  color: var(--muted);
  white-space: nowrap;
}

.chip.muted {
  opacity: 0.6;
}

.chip.lock {
  color: var(--warn);
  border-color: color-mix(in oklab, var(--warn) 35%, var(--border));
  background: color-mix(in oklab, var(--warn) 9%, transparent);
}

.badge {
  font-size: 0.56rem;
  padding: 0.1rem 0.3rem;
  letter-spacing: 0.05em;
}

.search-field {
  position: relative;
  display: block;
}

.search-field input {
  width: 100%;
  padding-left: 2.2rem;
  font-family: var(--font-body);
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  width: 0.95rem;
  height: 0.95rem;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}

.search-icon svg {
  width: 100%;
  height: 100%;
}

.oasf-grid {
  grid-template-columns: 14.5rem minmax(0, 1fr);
  gap: 0.9rem;
  align-items: start;
}

.oasf-col {
  min-width: 0;
}

.domain-list,
.skill-list {
  list-style: none;
  margin: 0;
  padding: 0 0.15rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 17rem;
  overflow-y: auto;
}

.domain-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
  cursor: pointer;
  font-size: 0.8rem;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.domain-chip:hover {
  border-color: color-mix(in oklab, var(--accent) 38%, var(--border));
}

.domain-chip.partial {
  border-style: dashed;
}

.domain-chip:has(input:checked) {
  border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
  background: color-mix(in oklab, var(--accent) 9%, var(--bg));
}

.domain-chip input,
.skill-chip input {
  width: 0.95rem;
  height: 0.95rem;
  flex-shrink: 0;
  accent-color: var(--accent);
}

.domain-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.domain-count {
  font-size: 0.66rem;
  color: var(--muted);
  background: var(--surface-2);
  border-radius: 2rem;
  padding: 0.05rem 0.35rem;
}

.skill-chip {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.skill-chip:hover {
  border-color: color-mix(in oklab, var(--accent) 38%, var(--border));
}

.skill-chip:has(input:checked) {
  border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
  background: color-mix(in oklab, var(--accent) 9%, var(--bg));
}

.skill-chip input {
  margin-top: 0.18rem;
}

.skill-body {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.skill-body strong {
  font-size: 0.81rem;
  font-weight: 600;
}

.skill-body em {
  font-style: normal;
  font-size: 0.69rem;
  color: var(--muted);
}

.nav {
  bottom: -1.35rem;
  margin-left: -1.35rem;
  margin-right: -1.35rem;
  margin-bottom: -1.35rem;
  padding: 0.85rem 1.35rem;
  background: color-mix(in oklab, var(--surface) 86%, transparent);
  backdrop-filter: blur(14px);
}

.nav-note {
  font-size: 0.7rem;
  color: var(--muted);
  white-space: nowrap;
}

.nav-end {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.creating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 2.25rem 0;
}

.spinner {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  border: 3px solid color-mix(in oklab, var(--accent) 20%, transparent);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.creating-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 600;
}

.success-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 1.1rem 0.5rem 0.55rem;
  text-align: center;
}

.success-badge {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, color-mix(in oklab, var(--ok-ink) 72%, #04220f), var(--ok-ink));
  box-shadow: 0 0 0 8px color-mix(in oklab, var(--ok-ink) 11%, transparent);
  animation: pop-in 0.5s var(--ease-spring) both;
}

.success-badge svg {
  width: 1.5rem;
  height: 1.5rem;
}

@keyframes pop-in {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
}

.success-title {
  margin: 0.45rem 0 0;
  font-family: var(--font-display);
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.detail-grid .mini-card-wide {
  grid-column: 1 / -1;
}

.service-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.service-list li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg);
  font-size: 0.76rem;
}

.service-name {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.service-list a,
.service-list .mono {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.steps {
  gap: 0.3rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  background: var(--bg);
  font-size: 0.72rem;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.step-mark {
  width: 0.42rem;
  height: 0.42rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ok-ink);
}

.step-mark.fail {
  background: var(--danger-base);
}

.step-status {
  color: var(--muted);
}

.fund-panel {
  gap: 0.7rem;
  padding: 0.9rem;
  border-radius: 0.8rem;
  background: color-mix(in oklab, var(--surface-2) 45%, transparent);
}

.fund-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.preset {
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.3rem 0.6rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.preset:hover:not(:disabled) {
  color: var(--ink);
  border-color: color-mix(in oklab, var(--accent) 38%, var(--border));
}

.preset.on {
  color: var(--accent);
  border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
  background: color-mix(in oklab, var(--accent) 10%, var(--bg));
}

.preset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ephemeral-key {
  border-radius: 0.7rem;
}

@media (max-width: 620px) {
  .identity {
    grid-template-columns: 1fr;
  }

  .avatar-col {
    flex-direction: row;
  }

  .avatar-col .dropzone,
  .avatar-col .image-preview {
    flex: 1;
  }

  .field-grid,
  .ability-grid,
  .oasf-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .field-wide {
    grid-column: auto;
  }

  .stepper-name {
    display: none;
  }
}

/* ---------- Celebration / success ---------- */

.success-hero {
  position: relative;
  overflow: hidden;
  padding: 1.5rem 0.75rem 0.9rem;
  border-radius: 1rem;
  background:
    radial-gradient(120% 130% at 50% -30%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 62%);
}

.confetti {
  position: absolute;
  inset: 0 0 auto;
  height: 9rem;
  overflow: hidden;
  pointer-events: none;
}

.confetti i {
  position: absolute;
  top: -1rem;
  width: 0.32rem;
  height: 0.55rem;
  border-radius: 2px;
  opacity: 0;
  animation: confetti-fall 2.7s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}

.confetti i:nth-child(3n) {
  width: 0.24rem;
  height: 0.7rem;
  border-radius: 1px;
}

.confetti i:nth-child(1) { left: 4%; background: var(--accent); animation-delay: 0.05s; }
.confetti i:nth-child(2) { left: 12%; background: var(--orb-2); animation-delay: 0.28s; animation-duration: 3.1s; }
.confetti i:nth-child(3) { left: 20%; background: var(--ok-ink); animation-delay: 0.12s; animation-duration: 2.4s; }
.confetti i:nth-child(4) { left: 27%; background: var(--star); animation-delay: 0.42s; }
.confetti i:nth-child(5) { left: 35%; background: var(--accent); animation-delay: 0.18s; animation-duration: 3s; }
.confetti i:nth-child(6) { left: 42%; background: var(--orb-2); animation-delay: 0.5s; }
.confetti i:nth-child(7) { left: 48%; background: var(--ok-ink); animation-delay: 0.08s; animation-duration: 2.5s; }
.confetti i:nth-child(8) { left: 54%; background: var(--star); animation-delay: 0.35s; animation-duration: 3.2s; }
.confetti i:nth-child(9) { left: 60%; background: var(--accent); animation-delay: 0.22s; }
.confetti i:nth-child(10) { left: 66%; background: var(--orb-2); animation-delay: 0.55s; animation-duration: 2.6s; }
.confetti i:nth-child(11) { left: 72%; background: var(--ok-ink); animation-delay: 0.15s; animation-duration: 3s; }
.confetti i:nth-child(12) { left: 78%; background: var(--star); animation-delay: 0.38s; }
.confetti i:nth-child(13) { left: 83%; background: var(--accent); animation-delay: 0.02s; animation-duration: 2.8s; }
.confetti i:nth-child(14) { left: 88%; background: var(--orb-2); animation-delay: 0.3s; animation-duration: 2.4s; }
.confetti i:nth-child(15) { left: 93%; background: var(--star); animation-delay: 0.48s; animation-duration: 3.1s; }
.confetti i:nth-child(16) { left: 97%; background: var(--ok-ink); animation-delay: 0.1s; }
.confetti i:nth-child(17) { left: 8%; background: var(--star); animation-delay: 0.6s; animation-duration: 3.3s; }
.confetti i:nth-child(18) { left: 57%; background: var(--accent); animation-delay: 0.65s; animation-duration: 2.9s; }

@keyframes confetti-fall {
  0% {
    opacity: 0;
    transform: translateY(-0.5rem) rotate(0deg);
  }
  12% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(8.5rem) rotate(340deg);
  }
}

.success-hero .success-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 4.3rem;
  height: 4.3rem;
  margin: 0 auto;
  border-radius: 1.2rem;
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--accent) 82%, #fff),
    color-mix(in oklab, var(--accent) 42%, #7b5cff)
  );
  box-shadow: 0 14px 34px -14px var(--glow), 0 0 0 6px color-mix(in oklab, var(--accent) 9%, transparent);
  animation: avatar-in 0.6s var(--ease-spring) both;
}

.success-avatar.with-image {
  background: var(--surface-2);
}

.success-avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.avatar-initials {
  font-family: var(--font-display);
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--on-accent);
}

.avatar-check {
  position: absolute;
  right: -0.35rem;
  bottom: -0.35rem;
  display: grid;
  place-items: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 50%;
  border: 2px solid var(--surface);
  background: var(--ok-ink);
  color: #fff;
  box-shadow: 0 4px 10px rgb(var(--shadow-rgb) / 0.35);
}

.avatar-check svg {
  width: 0.85rem;
  height: 0.85rem;
}

@keyframes avatar-in {
  from {
    opacity: 0;
    transform: scale(0.55) translateY(0.6rem);
  }
}

.success-hero .live-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.7rem;
  padding: 0.18rem 0.55rem;
  border-radius: 2rem;
  border: 1px solid color-mix(in oklab, var(--ok-ink) 30%, transparent);
  background: color-mix(in oklab, var(--ok-ink) 11%, transparent);
  color: var(--ok-ink);
  font-size: 0.68rem;
  font-weight: 600;
}

.live-pill i {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--ok-ink);
  animation: live-pulse 1.9s ease-out infinite;
}

@keyframes live-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--ok-ink) 55%, transparent);
  }
  70%,
  100% {
    box-shadow: 0 0 0 0.35rem transparent;
  }
}

.success-hero .success-title {
  margin-top: 0.45rem;
  font-size: 1.35rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.hero-action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font: inherit;
  font-size: 0.71rem;
  font-weight: 600;
  padding: 0.32rem 0.65rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--surface-2) 65%, transparent);
  color: var(--muted);
  cursor: pointer;
  transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease,
    transform 0.16s var(--ease-spring);
}

.hero-action:hover {
  color: var(--ink);
  background: var(--surface-2);
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  transform: translateY(-1px);
}

.hero-action:active {
  transform: scale(0.96);
}

.hero-action svg {
  width: 0.8rem;
  height: 0.8rem;
}

.next-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.next-steps li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.6rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  background: var(--bg);
}

.ns-num {
  display: grid;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: color-mix(in oklab, var(--accent) 13%, transparent);
  color: var(--accent);
  font-size: 0.66rem;
  font-weight: 700;
}

.next-steps strong {
  display: block;
  font-size: 0.77rem;
  font-weight: 600;
}

.next-steps em {
  display: block;
  margin-top: 0.05rem;
  font-style: normal;
  font-size: 0.67rem;
  line-height: 1.35;
  color: var(--muted);
}

@media (max-width: 620px) {
  .next-steps {
    grid-template-columns: 1fr;
  }
}
</style>
