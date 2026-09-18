<script setup lang="ts">
import { computed, ref } from 'vue'
import { fundAgent } from '../api'

const props = defineProps<{
  agentAddress?: string
  agentName?: string
}>()

const emit = defineEmits<{
  funded: []
}>()

const amount = ref('0.001')
const localError = ref('')
const statusText = ref('')
const statusKind = ref<'info' | 'ok' | 'error'>('info')
const busy = ref(false)

const canSend = computed(() => {
  if (!props.agentName || !props.agentAddress || busy.value) return false
  const n = Number(amount.value)
  return Number.isFinite(n) && n > 0 && n <= 1
})

function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Transfer failed'
  const line = raw.split('\n')[0] || raw
  if (/insufficient funds|insufficient balance/i.test(line)) {
    return 'Master wallet has insufficient ETH. Fund it on Arbitrum Sepolia, then retry.'
  }
  if (/exceeds defined limit|limit exceeded|-32005|429/i.test(line)) {
    return 'RPC rate limit hit. Wait a few seconds and retry.'
  }
  return line
}

async function fund() {
  if (!canSend.value || !props.agentName) return
  localError.value = ''
  statusText.value = 'Sending from master wallet…'
  statusKind.value = 'info'
  busy.value = true

  try {
    const result = await fundAgent(props.agentName, amount.value)
    statusText.value = `Sent ${result.txHash.slice(0, 10)}…`
    statusKind.value = 'ok'
    emit('funded')
  } catch (err) {
    localError.value = friendlyError(err)
    statusText.value = localError.value
    statusKind.value = 'error'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <header class="head">
      <h2>Fund agent</h2>
      <p class="sub">
        Transfer ETH from master wallet
        <template v-if="agentName"> to {{ agentName }}</template>
      </p>
    </header>

    <p v-if="!agentName || !agentAddress" class="hint">Select an agent with a wallet address.</p>

    <form v-else class="form" @submit.prevent="fund">
      <label class="field">
        <span>Amount (ETH)</span>
        <input
          v-model="amount"
          type="text"
          inputmode="decimal"
          placeholder="0.001"
          spellcheck="false"
          :disabled="busy"
        />
      </label>
      <button class="btn primary" type="submit" :disabled="!canSend">
        {{ busy ? 'Sending…' : 'Send to agent' }}
      </button>
    </form>

    <p v-if="statusText" class="status" :class="statusKind">{{ statusText }}</p>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.15rem 1.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.sub {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.78rem;
}

.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  font-size: 0.9rem;
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

.status {
  margin: 0;
  font-size: 0.78rem;
  word-break: break-all;
}

.status.info {
  color: var(--muted);
}

.status.ok {
  color: #6ecf8e;
}

.status.error {
  color: #ffb4b0;
}
</style>
