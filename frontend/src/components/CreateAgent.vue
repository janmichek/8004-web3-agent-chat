<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  createAgent,
  fetchCatalog,
  scanUrlForAgent,
  type AgentSummary,
  type CatalogResponse,
  type CreateAgentStep,
} from '../api'

type Phase =
  | 'env'
  | 'configure'
  | 'fund'
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
const selectedActions = ref<string[]>([])
const selectedTools = ref<string[]>([])
const fundEth = ref('0.002')
const skipRegister = ref(false)

const createSteps = ref<CreateAgentStep[]>([])
const createdAgent = ref<AgentSummary | null>(null)
const createdBalance = ref('')

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

const fundValid = computed(() => {
  const n = Number(fundEth.value)
  return Number.isFinite(n) && n >= 0 && n <= 1
})

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
  if (!fundValid.value || busy.value) return
  phase.value = 'creating'
  createError.value = ''
  createSteps.value = []
  createdAgent.value = null
  busy.value = true

  try {
    const res = await createAgent({
      name: agentName.value.trim(),
      actions: selectedActions.value,
      tools: selectedTools.value,
      fundEth: fundEth.value.trim() || '0.002',
      skipRegister: skipRegister.value,
    })
    createSteps.value = res.steps
    createdAgent.value = res.agent
    createdBalance.value = res.balanceEth
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
      <div class="nav">
        <button type="button" class="btn primary" data-testid="create-name-continue" :disabled="!catalog || !nameValid" @click="goConfigure">
          Next →
        </button>
      </div>
    </div>

    <!-- Configure (step 2) — flat tools & actions -->
    <div v-else-if="phase === 'configure'" class="body">
      <p class="step-label">Configure your agent — tools &amp; actions</p>
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
        <button type="button" class="btn primary" @click="phase = 'fund'">Next →</button>
      </div>
    </div>

    <!-- Fund + register -->
    <div v-else-if="phase === 'fund'" class="body">
      <p class="step-label">Fund &amp; register</p>
      <label class="field">
        <span>ETH to fund agent</span>
        <input
          v-model="fundEth"
          type="text"
          inputmode="decimal"
          placeholder="0.002"
          spellcheck="false"
        />
      </label>
      <label class="check skip">
        <input v-model="skipRegister" type="checkbox" />
        <span>Skip ERC-8004 registration</span>
      </label>
      <div class="nav">
        <button type="button" class="btn ghost" @click="phase = 'configure'">← Back</button>
        <button
          type="button"
          class="btn primary"
          :disabled="!fundValid || busy"
          @click="submitCreate"
        >
          Create agent
        </button>
      </div>
    </div>

    <!-- Creating -->
    <div v-else-if="phase === 'creating'" class="body">
      <p class="step-label">Creating “{{ agentName }}”…</p>
      <p class="hint creating-pulse">Wallet → fund → config → register</p>
    </div>

    <!-- Done -->
    <div v-else-if="phase === 'done' && createdAgent" class="body">
      <p class="step-label">Agent created</p>
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
      </dl>
      <ul v-if="createSteps.length" class="steps">
        <li v-for="s in createSteps" :key="s.step" :class="{ fail: !s.ok }">
          <span class="mono">{{ s.step }}</span>
          — {{ s.ok ? 'ok' : 'failed' }}
          <template v-if="s.detail"> · {{ s.detail }}</template>
        </li>
      </ul>
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
        <button type="button" class="btn ghost" @click="phase = 'fund'">← Back</button>
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

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
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

.check.skip {
  border: none;
  background: transparent;
  padding: 0.25rem 0;
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
