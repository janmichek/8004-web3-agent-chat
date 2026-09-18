<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import { useBalance } from '@wagmi/vue'
import { formatEther, isAddress, type Address } from 'viem'
import { fetchAgents, fetchHealth, fetchReputation, fundAgent, deleteAgent, type AgentSummary } from '../api'

const props = defineProps<{
  selectName?: string | null
  agent?: AgentSummary | null
  scanId?: string | null
  scanUrl?: string | null
  refreshKey?: number
}>()

const addr = computed<Address | undefined>(() =>
  props.agent?.walletAddress && isAddress(props.agent.walletAddress)
    ? (props.agent.walletAddress as Address)
    : undefined,
)
const hasTarget = computed(() => Boolean(addr.value))
const eth = useBalance({ address: addr, query: { enabled: hasTarget } })

const ethDisplay = computed(() => {
  if (!addr.value) return '—'
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  if (unref(eth.error)) return 'Error'
  const d = unref(eth.data)
  if (d?.value === undefined) return '—'
  return `${Number(formatEther(d.value)).toPrecision(6)} ETH`
})

const walletScanUrl = computed(() => {
  const address = props.agent?.walletAddress
  if (!address) return null
  const chainId = props.agent?.walletChainId ?? 421614
  const base = chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/address/${address}`
})

const masterScanUrl = computed(() => {
  if (!masterAddress.value) return null
  const base = masterChainId.value === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/address/${masterAddress.value}`
})

const metadataUrl = computed(() => {
  const uri = props.agent?.agentURI
  if (!uri?.startsWith('ipfs://')) return null
  return `https://ipfs.io/ipfs/${uri.slice(7)}`
})

const canSend = computed(() => {
  if (!props.agent?.name || !addr.value || fundBusy.value) return false
  const n = Number(fundAmount.value)
  return Number.isFinite(n) && n > 0 && n <= 1
})

function shortAddr(a: string): string {
  return a.length > 13 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Transfer failed'
  const line = (raw.split('\n')[0] || raw)
  if (/insufficient funds|insufficient balance/i.test(line)) return 'Master wallet has insufficient ETH.'
  if (/exceeds defined limit|limit exceeded|-32005|429/i.test(line)) return 'RPC rate limit hit. Wait a few seconds and retry.'
  return line
}

async function fund() {
  if (!canSend.value || !props.agent?.name) return
  fundStatusText.value = 'Sending from master wallet…'
  fundStatusKind.value = 'info'
  fundBusy.value = true
  try {
    const r = await fundAgent(props.agent.name, fundAmount.value)
    fundStatusText.value = `Sent ${r.txHash.slice(0, 10)}…`
    fundStatusKind.value = 'ok'
    emit('funded', r.txHash)
  } catch (err) {
    fundStatusText.value = friendlyError(err)
    fundStatusKind.value = 'error'
  } finally { fundBusy.value = false }
}

watch(
  () => props.refreshKey,
  () => {
    if (hasTarget.value) void eth.refetch()
    void loadAgents()
  },
)

const agents = ref<AgentSummary[]>([])
const selected = ref('')
const loadError = ref('')
const open = ref(false)
const fundAmount = ref('0.001')
const fundStatusText = ref('')
const fundStatusKind = ref<'info' | 'ok' | 'error'>('info')
const fundBusy = ref(false)
const deleteBusy = ref(false)
const deleteStatusText = ref('')
const deleteConfirm = ref(false)
const masterAddress = ref('')
const masterChainId = ref(421614)
const ratingText = ref('')
const ratingLoading = ref(false)

watch(
  () => props.agent?.agentId,
  (id) => {
    void loadRating(id)
  },
)

async function loadRating(agentId?: string) {
  ratingText.value = ''
  if (!agentId?.trim()) return
  ratingLoading.value = true
  try {
    const r = await fetchReputation(agentId.trim())
    ratingText.value = r.count
      ? `★ ${r.averageValue.toFixed(1)}/100 · ${r.count} rating${r.count === 1 ? '' : 's'}`
      : 'No ratings yet'
  } catch {
    ratingText.value = ''
  } finally {
    ratingLoading.value = false
  }
}

const emit = defineEmits<{
  select: [agent: AgentSummary | null]
  create: []
  funded: [txHash: string]
  deleted: [name: string]
}>()

async function loadAgents() {
  loadError.value = ''
  try {
    const data = await fetchAgents()
    agents.value = data.agents
    if (props.selectName && data.agents.some((a) => a.name === props.selectName)) {
      selected.value = props.selectName
    } else if (!selected.value && data.agents[0]) {
      selected.value = data.agents[0].name
    } else if (selected.value && !data.agents.some((a) => a.name === selected.value)) {
      selected.value = data.agents[0]?.name ?? ''
    }
  } catch (err) {
    loadError.value =
      err instanceof Error
        ? err.message
        : 'API unavailable — run npm run serve'
  }
}

watch(selected, (name) => {
  const agent = agents.value.find((a) => a.name === name) ?? null
  emit('select', agent)
})

watch(
  () => props.selectName,
  (name) => {
    if (name && agents.value.some((a) => a.name === name)) {
      selected.value = name
    } else if (name) {
      void loadAgents()
    }
  },
)

async function refreshAll() {
  if (hasTarget.value) void eth.refetch()
  await loadAgents()
}

async function removeAgent() {
  const name = props.agent?.name
  if (!name || deleteBusy.value) return
  if (!deleteConfirm.value) {
    deleteConfirm.value = true
    deleteStatusText.value = `Click Delete again to confirm removal of "${name}".`
    return
  }
  deleteBusy.value = true
  deleteStatusText.value = `Deleting "${name}"…`
  try {
    await deleteAgent(name)
    deleteConfirm.value = false
    deleteStatusText.value = ''
    emit('deleted', name)
    await loadAgents()
  } catch (err) {
    deleteStatusText.value = friendlyError(err)
  } finally {
    deleteBusy.value = false
  }
}

watch(
  () => props.agent?.name,
  () => {
    deleteConfirm.value = false
    deleteStatusText.value = ''
  },
)

onMounted(() => {
  void loadAgents()
  void loadRating(props.agent?.agentId)
  void fetchHealth()
    .then((h) => {
      if (h.master?.address) masterAddress.value = h.master.address
      if (h.chainId) masterChainId.value = h.chainId
    })
    .catch(() => {})
})
</script>

<template>
  <section class="card">
    <header class="card-head">
      <h2>Agent</h2>
      <div class="head-actions">
        <button type="button" class="btn ghost small icon-only" title="Refresh" aria-label="Refresh" data-testid="picker-refresh" @click="refreshAll">↻</button>
        <button type="button" class="btn primary small" data-testid="picker-create" @click="emit('create')">
          Create agent
        </button>
      </div>
    </header>

    <div class="pick">
      <select id="agent-select" v-model="selected" data-testid="agent-select" :disabled="!agents.length" aria-label="Select agent">
        <option v-if="!agents.length" value="">No agents</option>
        <option v-for="a in agents" :key="a.name" :value="a.name">
          {{ a.name }}
        </option>
      </select>
    </div>

    <div class="sub-section">
      <button
        type="button"
        class="title-toggle"
        @click="open = !open"
        :aria-expanded="open ? 'true' : 'false'"
        title="Toggle Agent Info section"
      >
        <span class="chev" :class="{ closed: !open }" aria-hidden="true">▾</span>
        <span class="sub-title">Agent Info</span>
      </button>

      <div v-show="open" class="collapsible-body">

    <p v-if="loadError" class="banner" data-testid="picker-error">{{ loadError }}</p>
    <p v-else-if="!agents.length" class="hint">
      No agents yet — create one to get started (same flow as <code>npm run create-agent</code>).
    </p>

    <div v-if="agent" class="details">
      <dl>
        <div v-if="agent.agentId">
          <dt>ERC-8004</dt>
          <dd class="mono">
            <a v-if="scanUrl && scanId" :href="scanUrl" target="_blank" rel="noopener noreferrer">#{{ scanId }} ↗</a>
            <span v-else>#{{ agent.agentId }}</span>
          </dd>
        </div>
        <div v-if="metadataUrl && agent.agentURI">
          <dt>Metadata</dt>
          <dd class="mono">
            <a
              :href="metadataUrl"
              target="_blank"
              rel="noopener noreferrer"
              :title="agent.agentURI"
              >{{ shortAddr(agent.agentURI) }} ↗</a
            >
          </dd>
        </div>
        <div v-if="agent.walletAddress">
          <dt>Wallet</dt>
          <dd class="mono">
            <a
              v-if="walletScanUrl"
              :href="walletScanUrl"
              target="_blank"
              rel="noopener noreferrer"
              :title="agent.walletAddress"
              >{{ shortAddr(agent.walletAddress) }} ↗</a
            >
            <span v-else :title="agent.walletAddress">{{ shortAddr(agent.walletAddress) }}</span>
          </dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd class="mono">{{ ethDisplay }}</dd>
        </div>
        <div v-if="agent.agentId">
          <dt>Rating</dt>
          <dd class="mono" data-testid="agent-rating">{{ ratingLoading ? '…' : (ratingText || '—') }}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>
            <div v-if="agent.tools.length" class="chips">
              <span v-for="t in agent.tools" :key="t" class="chip mono">{{ t }}</span>
            </div>
            <span v-else class="muted">none</span>
          </dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>
            <div v-if="agent.actions.length" class="chips">
              <span v-for="a in agent.actions" :key="a" class="chip mono">{{ a }}</span>
            </div>
            <span v-else class="muted">none</span>
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="agent" class="danger-zone">
      <button
        type="button"
        class="btn ghost small danger"
        data-testid="picker-delete"
        :disabled="deleteBusy"
        :title="deleteConfirm ? 'Click again to confirm' : `Delete agent ${agent.name}`"
        @click="removeAgent"
      >
        {{ deleteBusy ? 'Deleting…' : deleteConfirm ? 'Confirm delete' : 'Delete' }}
      </button>
      <p v-if="deleteStatusText" class="status" data-testid="delete-status">{{ deleteStatusText }}</p>
    </div>

    <div v-if="agent" class="fund">
      <span class="sub-title">Fund Agent</span>
      <div v-if="masterAddress" class="master">
        <dt>Master wallet</dt>
        <dd class="mono">
          <a
            v-if="masterScanUrl"
            :href="masterScanUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="masterAddress"
            >{{ shortAddr(masterAddress) }} ↗</a
          >
          <span v-else :title="masterAddress">{{ shortAddr(masterAddress) }}</span>
        </dd>
      </div>
      <p v-if="!addr" class="hint">Select an agent with a wallet address.</p>
      <template v-else>
        <form class="form" @submit.prevent="fund">
          <label class="field">
            <span>Amount (ETH)</span>
            <input v-model="fundAmount" type="text" inputmode="decimal" placeholder="0.001" data-testid="fund-amount" :disabled="fundBusy" />
          </label>
          <button class="btn primary" type="submit" data-testid="fund-submit" :disabled="!canSend">{{ fundBusy ? 'Sending…' : 'Send' }}</button>
        </form>
        <p v-if="fundStatusText" class="status" data-testid="fund-status" :class="fundStatusKind">{{ fundStatusText }}</p>
      </template>
    </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.card-head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.pick {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pick select {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.45rem 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}

.pick select:disabled {
  opacity: 0.6;
}

.pick .status {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}

.banner {
  margin: 0;
  padding: 0.55rem 0.65rem;
  background: color-mix(in oklab, var(--warn) 12%, var(--surface));
  color: var(--warn);
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
}

.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.45;
}

.hint code {
  font-family: var(--font-mono);
  font-size: 0.78em;
  background: color-mix(in oklab, var(--border) 60%, transparent);
  padding: 0.12em 0.3em;
  border-radius: 0.25em;
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}
.btn.small.icon-only {
  padding: 0.35rem 0.5rem;
  font-size: 0.9rem;
  line-height: 1;
}

.details {
  padding-top: 0;
}

.details dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.details dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.details dd {
  margin: 0.15rem 0 0;
  font-size: 0.85rem;
  word-break: break-all;
}

.details dd a {
  color: var(--accent);
  text-decoration: none;
}

.details dd a:hover {
  text-decoration: underline;
}

.mono { font-family: var(--font-mono, ui-monospace, monospace); }
.muted { color: var(--muted); font-size: 0.85rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.25rem; }
.chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.22rem 0.5rem; border-radius: 999px; background: var(--surface-2, color-mix(in oklab, var(--border) 45%, var(--surface))); border: 1px solid var(--border); font-size: 0.72rem; color: var(--ink); }

.fund { display: flex; flex-direction: column; gap: 0.6rem; border-top: 1px solid var(--border); padding-top: 0.75rem; }
.danger-zone { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem; padding-bottom: 0.1rem; }
.danger-zone .status { margin: 0; font-size: 0.78rem; color: var(--muted); word-break: break-all; }
.btn.danger { color: #ffb4b0; border-color: color-mix(in oklab, #ffb4b0 40%, var(--border)); }
.master dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.master dd { margin: 0.15rem 0 0; font-size: 0.85rem; word-break: break-all; }
.master dd a { color: var(--accent); text-decoration: none; }
.master dd a:hover { text-decoration: underline; }
.form { display: flex; flex-direction: column; gap: 0.6rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.75rem; color: var(--muted); }
.field input { font: inherit; font-family: var(--font-mono); font-size: 0.9rem; padding: 0.6rem 0.75rem; border-radius: 0.4rem; border: 1px solid var(--border); background: var(--bg); color: var(--ink); }
.status { margin: 0; font-size: 0.78rem; word-break: break-all; }
.status.info { color: var(--muted); }
.status.ok { color: #6ecf8e; }
.status.error { color: #ffb4b0; }

.head-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.title-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.title-toggle h2 { margin: 0; font-size: 0.95rem; font-weight: 600; }
.sub-section { display: flex; flex-direction: column; gap: 0.6rem; }
.sub-title { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.chev { font-size: 0.75rem; color: var(--muted); transition: transform 0.15s ease; }
.chev.closed { transform: rotate(-90deg); }
.collapsible-body { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
