<script setup lang="ts">
import { computed, onMounted, ref, unref, watch } from 'vue'
import { useAccount, useBalance, useConfig } from '@wagmi/vue'
import { getAccount, getBalance, sendTransaction, waitForTransactionReceipt } from '@wagmi/vue/actions'
import { useWeb3Auth, useWeb3AuthConnect } from '@web3auth/modal/vue'
import { formatEther, isAddress, parseEther, type Address } from 'viem'
import { errorLine, friendlyFundError, shortAddr, e2eConnectedAddress, e2eSendTx } from '@/shared/lib'
import { ensureChain, prepareNativeTransfer } from '@/shared/lib'
import { addressExplorerUrl, networkInfo } from '@/shared/config'
import AgentSelect from './AgentSelect.vue'
import AgentCard from '../agent-card/AgentCard.vue'
import { ModalDialog } from '@/shared/ui'
import {
  fetchAgents,
  fetchReputation,
  deleteAgent,
  deleteAgentBackup,
  sortAgentsByLastUsed,
  type AgentSummary,
} from '@/shared/api'

const props = defineProps<{
  selectName?: string | null
  agent?: AgentSummary | null
  refreshKey?: number
}>()

const wagmiConfig = useConfig()
const { address: wagmiAddress } = useAccount()
const { isInitialized, initError } = useWeb3Auth()
const { connect, loading: connectLoading } = useWeb3AuthConnect()

const signInDisabled = computed(
  () => connectLoading.value || !isInitialized.value || !!initError.value,
)

async function signIn() {
  await connect()
}

/** Playwright can set window.__E2E_CONNECTED_ADDRESS to simulate a connected wallet. */
const connectedAddress = computed<Address | undefined>(
  () => e2eConnectedAddress() ?? wagmiAddress.value ?? getAccount(wagmiConfig).address,
)

const addr = computed<Address | undefined>(() =>
  props.agent?.walletAddress && isAddress(props.agent.walletAddress)
    ? (props.agent.walletAddress as Address)
    : undefined,
)
const hasTarget = computed(() => Boolean(addr.value))
// The agent's balance lives on its own chain, whatever chain the wallet is on.
const agentChainId = computed(() => networkInfo(props.agent?.walletChainId).chainId)
const eth = useBalance({ address: addr, chainId: agentChainId, query: { enabled: hasTarget } })

const ethDisplay = computed(() => {
  if (!addr.value) return '—'
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  if (unref(eth.error)) return 'Error'
  const d = unref(eth.data)
  if (d?.value === undefined) return '—'
  return `${Number(formatEther(d.value)).toPrecision(6)} ETH`
})

const connectedScanUrl = computed(() => {
  if (!connectedAddress.value) return null
  // Fund the agent on the agent's chain from the connected wallet.
  return addressExplorerUrl(connectedAddress.value, props.agent?.walletChainId)
})

const metadataUrl = computed(() => {
  const uri = props.agent?.agentURI
  if (!uri?.startsWith('ipfs://')) return null
  return `https://ipfs.io/ipfs/${uri.slice(7)}`
})

const canSend = computed(() => {
  if (!props.agent?.name || !addr.value || !connectedAddress.value || fundBusy.value) return false
  const n = Number(fundAmount.value)
  return Number.isFinite(n) && n > 0 && n <= 1
})

function x402Title(mode?: string): string {
  return mode === 'facilitator'
    ? 'A2A callers pay in USDC on Base Sepolia; verified and settled by the x402 facilitator.'
    : 'The server has no X402_FACILITATOR_URL, so A2A payments are accepted without being charged.'
}

async function awaitFundSettlement(hash: `0x${string}`, chainId: number) {
  fundStatusText.value = 'Submitted — waiting for confirmation…'
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId })
  if (receipt.status !== 'success') {
    throw new Error('Funding transaction reverted on-chain.')
  }
}

/** Fund the selected agent from the user's connected wallet. */
async function fund() {
  if (!canSend.value || !props.agent?.name || !addr.value || !connectedAddress.value) return
  fundStatusText.value = 'Waiting for wallet signature…'
  fundStatusKind.value = 'info'
  fundBusy.value = true
  try {
    const chainId = agentChainId.value
    const amount = fundAmount.value.trim()
    const value = parseEther(amount as `${number}`)
    const to = addr.value
    const account = connectedAddress.value

    // Playwright has no real wallet: let tests stub the send + skip RPC prep.
    const stub = e2eSendTx()
    if (stub) {
      const hash = (await stub()) as `0x${string}`
      fundStatusText.value = `Sent ${hash.slice(0, 10)}…`
      fundStatusKind.value = 'ok'
      emit('funded', hash)
      return
    }

    await ensureChain(wagmiConfig, chainId)

    fundStatusText.value = 'Estimating gas…'
    const prepared = await prepareNativeTransfer({
      account,
      to,
      value,
      chainId,
    })
    const feeCap = prepared.maxFeePerGas ?? 0n
    const gasBudget = prepared.gas * feeCap
    const bal = await getBalance(wagmiConfig, { address: account, chainId })
    if (bal.value < value + gasBudget) {
      throw new Error('insufficient funds for gas')
    }

    fundStatusText.value = 'Waiting for wallet signature…'
    const hash = await sendTransaction(wagmiConfig, {
      account,
      to,
      value,
      chainId,
      gas: prepared.gas,
      maxFeePerGas: prepared.maxFeePerGas,
      maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
    })
    await awaitFundSettlement(hash, chainId)
    fundStatusText.value = `Sent ${hash.slice(0, 10)}…`
    fundStatusKind.value = 'ok'
    emit('funded', hash)
  } catch (err) {
    fundStatusText.value = friendlyFundError(err, 'wallet')
    fundStatusKind.value = 'error'
  } finally {
    fundBusy.value = false
  }
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
const fundAmount = ref('0.001')
const fundStatusText = ref('')
const fundStatusKind = ref<'info' | 'ok' | 'error'>('info')
const fundBusy = ref(false)
const deleteBusy = ref(false)
const deleteStatusText = ref('')
const deleteConfirm = ref(false)
const showDetails = ref(false)
const ratingText = ref('')
const ratingLoading = ref(false)
// Starts true: the list is fetched on mount, so "no agent" copy must not show first.
const listLoading = ref(true)

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
  loaded: []
}>()

async function loadAgents() {
  loadError.value = ''
  listLoading.value = true
  try {
    const data = await fetchAgents()
    agents.value = sortAgentsByLastUsed(data.agents)
    if (props.selectName && agents.value.some((a) => a.name === props.selectName)) {
      selected.value = props.selectName
    } else if (!selected.value && agents.value[0]) {
      selected.value = agents.value[0].name
    } else if (selected.value && !agents.value.some((a) => a.name === selected.value)) {
      selected.value = agents.value[0]?.name ?? ''
    }
  } catch (err) {
    loadError.value =
      err instanceof Error
        ? err.message
        : 'API unavailable — run npm run serve'
  } finally {
    listLoading.value = false
    emit('loaded')
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
    deleteAgentBackup(name)
    deleteConfirm.value = false
    deleteStatusText.value = ''
    showDetails.value = false
    emit('deleted', name)
    await loadAgents()
  } catch (err) {
    deleteStatusText.value = errorLine(err, 'Delete failed')
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
})
</script>

<template>
  <div class="picker">
    <div class="picker-row">
      <AgentSelect
        v-model="selected"
        :agents="agents"
        :loading="listLoading"
        @open="refreshAll"
        @create="emit('create')"
      />
      <button
        type="button"
        class="details-btn"
        data-testid="agent-details-btn"
        aria-label="Agent details"
        title="Agent details & funding"
        :disabled="!agent"
        @click="showDetails = true"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <circle cx="8" cy="11" r="2" />
          <path d="M5 16.25c.45-1.6 1.55-2.4 3-2.4s2.55.8 3 2.4" />
          <path d="M14 10.25h5" />
          <path d="M14 13.75h5" />
        </svg>
      </button>
    </div>
    <p v-if="loadError" class="banner" data-testid="picker-error">{{ loadError }}</p>
    <p v-else-if="!agents.length && !listLoading" class="hint">
      No agents yet — create one to get started (same flow as <code>npm run create-agent</code>).
    </p>
  </div>

  <ModalDialog v-if="showDetails && agent" hide-header label="Agent details" size="lg" @close="showDetails = false">
    <!-- The identity card is the modal's own header, so it sits directly in the dialog body. -->
    <AgentCard v-if="agent" :agent="agent" :status="agent.agentId ? 'live' : undefined" />

    <section class="card" data-testid="agent-info-section">
    <div v-if="agent" class="details">
    <div class="facts" data-testid="agent-facts">
      <div v-if="agent.agentId" class="fact rating">
        <svg class="fact-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" /></svg>
        <span class="fact-k">Rating</span>
        <span class="fact-v mono" data-testid="agent-rating">{{ ratingLoading ? '…' : (ratingText || '—') }}</span>
      </div>
      <div v-if="addr" class="fact balance" data-testid="agent-balance-fact">
        <svg class="fact-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.4l5.9 9.5-5.9 3.5-5.9-3.5z" fill="currentColor" opacity="0.85" />
          <path d="M12 17.1l5.9-3.9L12 21.6 6.1 13.2z" fill="currentColor" />
        </svg>
        <span class="fact-k">Balance</span>
        <span class="fact-v mono" data-testid="agent-balance">{{ ethDisplay }}</span>
      </div>
      <div v-if="agent.x402support" class="fact x402" data-testid="agent-x402" :title="x402Title(agent.x402Mode)">
        <svg class="fact-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" fill="currentColor" /></svg>
        <span class="fact-k">x402 payments</span>
        <span class="fact-v">
          {{ agent.x402Mode === 'facilitator' ? '0.01 USDC per A2A request' : 'Test mode (simulated)' }}
        </span>
      </div>
      <div v-if="metadataUrl && agent.agentURI" class="fact meta">
        <svg class="fact-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        <span class="fact-k">Metadata</span>
        <a class="fact-v mono" :href="metadataUrl" target="_blank" rel="noopener noreferrer" :title="agent.agentURI">{{ shortAddr(agent.agentURI) }} ↗</a>
      </div>
    </div>

    <div v-if="agent.services?.length" class="group" data-testid="agent-services">
      <h4 class="group-title">Services <span class="count">{{ agent.services.length }}</span></h4>
      <div class="chips">
        <template v-for="s in agent.services" :key="s.name">
          <a
            v-if="/^https?:\/\//i.test(s.endpoint)"
            class="chip mono service"
            :href="s.endpoint"
            :title="s.endpoint"
            target="_blank"
            rel="noopener noreferrer"
            ><i aria-hidden="true" />{{ s.name }} ↗</a
          >
          <span v-else class="chip mono service" :title="s.endpoint"><i aria-hidden="true" />{{ s.name }}</span>
        </template>
      </div>
    </div>

    <div class="group">
      <h4 class="group-title">Tools</h4>
      <div v-if="agent.tools.length" class="chips">
        <span v-for="t in agent.tools" :key="t" class="chip mono tool"><i aria-hidden="true" />{{ t }}</span>
      </div>
      <p v-else class="muted">none enabled</p>
    </div>

    <div class="group">
      <h4 class="group-title">Actions</h4>
      <div v-if="agent.actions.length" class="chips">
        <span v-for="a in agent.actions" :key="a" class="chip mono action"><i aria-hidden="true" />{{ a }}</span>
      </div>
      <p v-else class="muted">none enabled</p>
    </div>
  </div>

    </section>

    <div class="card-row">
      <section class="card" data-testid="fund-agent-section">
        <h3 class="card-title">Fund Agent</h3>
        <p v-if="!agent" class="hint">Select an agent to fund it.</p>
        <template v-else>
          <div v-if="connectedAddress" class="from-wallet">
            <dt>Connected wallet</dt>
            <dd class="mono">
              <a
                v-if="connectedScanUrl"
                :href="connectedScanUrl"
                target="_blank"
                rel="noopener noreferrer"
                :title="connectedAddress"
                >{{ shortAddr(connectedAddress) }} ↗</a
              >
              <span v-else :title="connectedAddress">{{ shortAddr(connectedAddress) }}</span>
            </dd>
          </div>
          <button
            v-else-if="addr"
            type="button"
            class="btn primary"
            data-testid="fund-sign-in"
            :disabled="signInDisabled"
            @click="signIn"
          >
            {{
              connectLoading
                ? 'Signing in…'
                : initError
                  ? 'Sign in unavailable'
                  : 'Sign in to fund this agent'
            }}
          </button>
          <p v-if="!addr" class="hint">Select an agent with a wallet address.</p>
          <template v-else-if="connectedAddress">
            <form class="form" @submit.prevent="fund">
              <label class="field">
                <span>Amount (ETH)</span>
                <input v-model="fundAmount" type="text" inputmode="decimal" placeholder="0.001" data-testid="fund-amount" :disabled="fundBusy" />
              </label>
              <button class="btn primary" type="submit" data-testid="fund-submit" :disabled="!canSend">{{ fundBusy ? 'Sending…' : 'Send' }}</button>
            </form>
            <p v-if="fundStatusText" class="status" data-testid="fund-status" :class="fundStatusKind">{{ fundStatusText }}</p>
          </template>
        </template>
      </section>

      <section v-if="agent" class="card danger-zone" data-testid="danger-zone-section">
        <h3 class="card-title">Danger Zone</h3>
        <div data-testid="agent-danger-section">
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
      </section>
    </div>

    <template #footer>
      <button type="button" class="btn ghost" data-testid="dialog-close" @click="showDetails = false">
        Close
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped src="../memory/memory-status.css"></style>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.picker-row { display: flex; align-items: stretch; gap: 0.5rem; min-width: 0; }
.picker-row > :first-child { flex: 1; min-width: 0; }
/* Borderless: the icon itself is the affordance, tinted on hover/active. */
.details-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 2.4rem;
  height: 2.4rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.details-btn:hover:not(:disabled),
.details-btn:focus-visible {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 12%, transparent);
}
.details-btn:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
  outline-offset: 1px;
}
.details-btn:active:not(:disabled) { color: var(--accent); }
.details-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.card-title { margin: 0; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }

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

.agent-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
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
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding-top: 0;
}

.details > * { animation: row-in 0.4s var(--ease-out) both; }
.details > :nth-child(2) { animation-delay: 0.05s; }
.details > :nth-child(3) { animation-delay: 0.1s; }
.details > :nth-child(4) { animation-delay: 0.15s; }
.details > :nth-child(n + 5) { animation-delay: 0.2s; }
@keyframes row-in {
  from { opacity: 0; transform: translateY(0.5rem); }
}

.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.6rem; }
.fact {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.7rem 0.8rem 0.7rem 2.6rem;
  border: 1px solid color-mix(in oklab, var(--tone, var(--accent)) 28%, var(--border));
  border-radius: 0.75rem;
  background: linear-gradient(145deg, color-mix(in oklab, var(--tone, var(--accent)) 11%, var(--surface)), var(--surface));
  transition: transform 0.2s var(--ease-spring), box-shadow 0.2s ease;
}
.fact:hover { transform: translateY(-2px); box-shadow: 0 12px 24px -18px var(--tone, var(--accent)); }
.fact.rating { --tone: #f5b301; }
.fact.balance { --tone: #4f8cff; }
.fact.x402 { --tone: var(--ok-ink); }
.fact-ico {
  position: absolute;
  left: 0.7rem;
  top: 0.75rem;
  width: 1.2rem;
  height: 1.2rem;
  color: var(--tone, var(--accent));
}
.fact.rating .fact-ico { animation: star-pop 2.8s var(--ease-spring) infinite; transform-origin: center; }
@keyframes star-pop { 0%, 80%, 100% { transform: scale(1) rotate(0); } 90% { transform: scale(1.25) rotate(14deg); } }
.fact-k { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.fact-v { font-size: 0.95rem; font-weight: 700; line-height: 1.25; color: var(--ink); overflow-wrap: anywhere; }
a.fact-v { color: var(--accent); text-decoration: none; font-size: 0.82rem; }
a.fact-v:hover { text-decoration: underline; }

.group { display: flex; flex-direction: column; gap: 0.4rem; }
.group-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.group-title::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border), transparent); }
.count {
  order: 1;
  padding: 0.02rem 0.4rem;
  border-radius: 2rem;
  background: color-mix(in oklab, var(--accent) 14%, transparent);
  color: var(--accent);
  font-size: 0.64rem;
  letter-spacing: 0;
}
.group-title { flex-wrap: nowrap; }
.group-title::after { order: 2; }

.chip {
  transition: transform 0.2s var(--ease-spring), border-color 0.15s ease, background 0.15s ease;
}
.chip:hover {
  transform: translateY(-1px) scale(1.04);
  background: color-mix(in oklab, var(--tone, var(--accent)) 14%, var(--surface-2));
  border-color: color-mix(in oklab, var(--tone, var(--accent)) 45%, var(--border));
}
.chip i { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: var(--tone, var(--accent)); flex-shrink: 0; }
.chip.service { --tone: var(--accent); }
.chip.tool { --tone: #7b5cff; }
.chip.action { --tone: var(--ok-ink); }

.mono { font-family: var(--font-mono, ui-monospace, monospace); }
.muted { color: var(--muted); font-size: 0.85rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.25rem; }
.chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.22rem 0.5rem; border-radius: 999px; background: var(--surface-2, color-mix(in oklab, var(--border) 45%, var(--surface))); border: 1px solid var(--border); font-size: 0.72rem; color: var(--ink); }
a.chip { text-decoration: none; color: var(--accent); }
a.chip:hover { border-color: color-mix(in oklab, var(--accent) 45%, var(--border)); }

.card-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; align-items: start; }
.card-row > .card { min-width: 0; }
.danger-zone { display: flex; flex-direction: column; align-items: flex-start; }
.danger-zone > div { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; }
.danger-zone .status { margin: 0; font-size: 0.78rem; color: var(--muted); word-break: break-all; }
.btn.danger { color: var(--danger-ink); border-color: color-mix(in oklab, var(--danger-ink) 40%, var(--border)); }
.from-wallet { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.5rem; }
.from-wallet dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); white-space: nowrap; }
.from-wallet dd { margin: 0; font-size: 0.85rem; white-space: nowrap; }
.from-wallet dd a { color: var(--accent); text-decoration: none; }
.from-wallet dd a:hover { text-decoration: underline; }
.form { display: flex; flex-direction: row; align-items: center; gap: 0.5rem; }
.field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--muted);
}
.field > span { flex: none; white-space: nowrap; }
.field input { flex: 1; min-width: 0; width: 100%; font: inherit; font-family: var(--font-mono); font-size: 0.9rem; padding: 0.6rem 0.75rem; border-radius: 0.4rem; border: 1px solid var(--border); background: var(--bg); color: var(--ink); }
.form > .btn { flex: none; }
.status { margin: 0; font-size: 0.78rem; word-break: break-all; }
.status.info { color: var(--muted); }
.status.ok { color: var(--ok-ink); }
.status.error { color: var(--danger-ink); }

</style>
