<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAccount } from '@wagmi/vue'
import { fetchReputation, scanUrlForAgent, submitFeedback, txScanUrl } from '../api'

const props = defineProps<{
  /** Local agent name used for the feedback API route. */
  agentName: string
  /** Default target agent ID, e.g. "421614:204". */
  defaultAgentId?: string
  walletChainId?: number
  owners?: string[]
  operators?: string[]
  /** Optional tx hash of the successful transaction being rated (display only). */
  txHash?: string
  /** Prefilled tag describing the rated interaction (per tool/action). */
  initialTag?: string
  /** Prefilled full service URL the rating applies to (origin-aware). */
  initialEndpoint?: string
}>()

const emit = defineEmits<{
  rated: [payload: { txHash: string; scanUrl: string }]
}>()

const { address: wagmiAddress } = useAccount()

/** Playwright can set window.__E2E_CONNECTED_ADDRESS to simulate a connected wallet. */
const connected = computed(() => {
  if (typeof window !== 'undefined') {
    const forced = (window as unknown as { __E2E_CONNECTED_ADDRESS?: string }).__E2E_CONNECTED_ADDRESS
    if (forced) return forced as `0x${string}`
  }
  return wagmiAddress.value
})

const agentId = computed(() => props.defaultAgentId?.trim() ?? '')
const stars = ref(5)
/** Quality rating context (stored as tag2 — tag1 is always 'starred'). */
const tag = ref(props.initialTag ?? 'starred')
/** Full service URL the rating applies to (origin-aware). */
const endpoint = ref(props.initialEndpoint ?? '')
/** Optional user-written review (public: tag2 fallback or IPFS feedback file). */
const comment = ref('')
const busy = ref(false)
const error = ref('')
const resultTx = ref('')
const scanUrl = ref('')
const feedbackURI = ref('')
const submitted = ref(false)
const reputation = ref<{ count: number; averageValue: number } | null>(null)
const loadingRep = ref(false)

watch(
  () => props.initialTag,
  (t) => {
    if (t && !submitted.value) tag.value = t
  },
)

watch(
  () => props.initialEndpoint,
  (e) => {
    if (e !== undefined && !submitted.value) endpoint.value = e
  },
)

const value = computed(() => stars.value * 20)

function addrIn(list: string[] | undefined, addr?: string): boolean {
  if (!addr || !list?.length) return false
  const a = addr.toLowerCase()
  return list.some((x) => x.toLowerCase() === a)
}

/** Connected wallet cannot rate if it is owner or operator of this agent. */
const blockedAsOwnerOrOperator = computed(() => {
  return (
    addrIn(props.owners, connected.value) || addrIn(props.operators, connected.value)
  )
})

const canSubmit = computed(() => {
  return Boolean(
    props.agentName &&
      agentId.value.trim() &&
      !busy.value &&
      !submitted.value &&
      !blockedAsOwnerOrOperator.value,
  )
})

const chainId = computed(() => props.walletChainId ?? 421614)

const previewScanUrl = computed(() => {
  const id = agentId.value.trim()
  if (!id) return ''
  return scanUrlForAgent(id, chainId.value, 'feedback')
})

const feedbackScanUrl = computed(() => {
  if (scanUrl.value) return scanUrl.value.includes('?tab=') ? scanUrl.value : `${scanUrl.value}?tab=feedback`
  return previewScanUrl.value
})

const ratingTxUrl = computed(() => {
  if (!resultTx.value) return ''
  return txScanUrl(resultTx.value, chainId.value)
})

function setStars(n: number) {
  stars.value = n
}

async function loadReputation() {
  const id = agentId.value.trim()
  if (!id) {
    reputation.value = null
    return
  }
  loadingRep.value = true
  try {
    reputation.value = await fetchReputation(id)
  } catch {
    reputation.value = null
  } finally {
    loadingRep.value = false
  }
}

watch(agentId, () => {
  submitted.value = false
  resultTx.value = ''
  scanUrl.value = ''
  feedbackURI.value = ''
  void loadReputation()
})

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  resultTx.value = ''
  scanUrl.value = ''
  feedbackURI.value = ''
  try {
    const res = await submitFeedback(props.agentName, {
      agentId: agentId.value.trim(),
      value: value.value,
      // Backend forces tag1='starred'; this is kept as tag2 context.
      tag: tag.value.trim() || 'starred',
      endpoint: endpoint.value.trim() || undefined,
      comment: comment.value.trim() || undefined,
    })
    resultTx.value = res.txHash
    feedbackURI.value = res.feedbackURI ?? ''
    const base = res.scanUrl || scanUrlForAgent(agentId.value.trim(), chainId.value)
    scanUrl.value = base.includes('?tab=') ? base : `${base}?tab=feedback`
    reputation.value = res.reputation
    submitted.value = true
    emit('rated', { txHash: res.txHash, scanUrl: scanUrl.value })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

void loadReputation()
</script>

<template>
  <section class="rate rate-card" aria-label="Rate agent" data-testid="rate-agent">
    <header class="head">
      <h2>Rate agent</h2>
      <p class="sub">On-chain ERC-8004 feedback (0–100)</p>
    </header>

    <p v-if="blockedAsOwnerOrOperator" class="hint warn" data-testid="rate-disabled">
      Connected wallet is an owner or operator of this agent — self-feedback is not allowed.
      Disconnect or use another wallet to rate.
    </p>

    <p class="rep" aria-live="polite">
      <template v-if="loadingRep">Loading reputation…</template>
      <template v-else-if="reputation"
        >★ {{ reputation.averageValue.toFixed(1) }}/100 · {{ reputation.count }} rating{{
          reputation.count === 1 ? '' : 's'
        }}</template
      >
      <template v-else-if="agentId.trim()">No reputation found (or lookup failed).</template>
    </p>

    <div class="stars" role="radiogroup" aria-label="Rating">
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        class="star"
        :class="{ on: n <= stars }"
        :aria-pressed="n === stars"
        :aria-label="`${n} star${n === 1 ? '' : 's'} (${n * 20}/100)`"
        :disabled="busy || blockedAsOwnerOrOperator || submitted"
        @click="setStars(n)"
      >
        ★
      </button>
      <span class="val mono">{{ value }}/100</span>
    </div>

    <!-- tag/endpoint are prefilled from chat (initialTag/initialEndpoint) and submitted hidden -->

    <label class="field">
      <span>Comment (optional, public)</span>
      <input
        v-model="comment"
        type="text"
        placeholder="Fast, smooth transfer"
        maxlength="280"
        data-testid="rate-comment"
        :disabled="busy || blockedAsOwnerOrOperator || submitted"
      />
    </label>

    <button
      class="btn"
      :class="submitted ? 'rated' : 'primary'"
      type="button"
      data-testid="rate-submit"
      :disabled="!canSubmit"
      @click="submit"
    >
      <template v-if="submitted">✓ Rated</template>
      <template v-else>{{ busy ? 'Submitting…' : `Submit ${value}/100 rating` }}</template>
    </button>

    <ul v-if="submitted" class="links" data-testid="rate-scan-link">
      <li v-if="ratingTxUrl">
        <a :href="ratingTxUrl" target="_blank" rel="noopener noreferrer">View rating TX</a>
      </li>
      <li v-if="feedbackScanUrl">
        <a :href="feedbackScanUrl" target="_blank" rel="noopener noreferrer">View on 8004scan</a>
      </li>
    </ul>
    <p v-if="error" class="status error" data-testid="rate-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.rate-card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border));
  border-radius: var(--radius);
  background:
    linear-gradient(135deg, color-mix(in oklab, var(--accent) 14%, transparent), transparent 60%),
    var(--surface-2, var(--surface));
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 12%, transparent);
  align-self: stretch;
  max-width: min(36rem, 100%);
}
.head h2 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}
.sub {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.76rem;
  word-break: break-all;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.hint.warn {
  color: var(--warn, #e8a54b);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  color: var(--muted);
}
.field input {
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--ink);
}
.rep {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.target {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}
.stars {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}
.star {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--border);
  padding: 0.1rem;
}
.star.on {
  color: #f5b942;
}
.star:disabled {
  cursor: default;
  opacity: 0.6;
}
.val {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.status {
  margin: 0;
  font-size: 0.78rem;
  word-break: break-all;
}
.status.ok {
  color: #6ecf8e;
}
.status.error {
  color: #ffb4b0;
}
.links {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  word-break: break-all;
}
.links a {
  color: var(--accent);
}
.btn.rated {
  background: #1f9d55;
  border-color: #1f9d55;
  color: #fff;
  cursor: default;
  opacity: 1;
}
.btn.rated:disabled {
  opacity: 1;
}
</style>
