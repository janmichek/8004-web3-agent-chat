<script setup lang="ts">
import { computed, unref, watch } from 'vue'
import { useAccount, useBalance } from '@wagmi/vue'
import { formatEther, type Address, isAddress } from 'viem'

const props = defineProps<{
  watchAddress?: string
  label?: string
  /** Bump to force a balance refetch (e.g. after a transfer). */
  refreshKey?: number
}>()

const { address: connected } = useAccount()

const target = computed<Address | undefined>(() => {
  if (props.watchAddress && isAddress(props.watchAddress)) {
    return props.watchAddress as Address
  }
  return connected.value
})

const hasTarget = computed(() => Boolean(target.value))

const eth = useBalance({
  address: target,
  query: { enabled: hasTarget },
})

const ethDisplay = computed(() => {
  if (!target.value) return '—'
  if (unref(eth.isFetching) && unref(eth.data) === undefined) return '…'
  const err = unref(eth.error)
  if (err) return 'Error'
  const data = unref(eth.data)
  if (data?.value === undefined) return '—'
  return `${Number(formatEther(data.value)).toPrecision(6)} ETH`
})

const shortTarget = computed(() => {
  if (!target.value) return null
  return `${target.value.slice(0, 6)}…${target.value.slice(-4)}`
})

function refresh() {
  void eth.refetch()
}

watch(
  () => props.refreshKey,
  () => {
    if (hasTarget.value) refresh()
  },
)

defineExpose({ refresh })
</script>

<template>
  <section class="panel">
    <header class="head">
      <div>
        <h2>{{ label || 'Balances' }}</h2>
        <p v-if="shortTarget" class="sub mono">{{ shortTarget }}</p>
        <p v-else class="sub">Connect a wallet to read balances</p>
      </div>
      <button type="button" class="btn ghost small" :disabled="!target" @click="refresh">
        Refresh
      </button>
    </header>

    <ul class="rows">
      <li>
        <span class="sym">ETH</span>
        <span class="amt mono">{{ ethDisplay }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.15rem 1.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

h2 {
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

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.rows li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  padding: 0.65rem 0.75rem;
  background: var(--surface-2);
  border-radius: 0.4rem;
}

.sym {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.amt {
  font-size: 0.95rem;
  text-align: right;
}

.btn.small {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
}
</style>
