<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { fetchMemory, type MemorySummary, type AgentSummary } from '../api'

const props = defineProps<{
  agent?: AgentSummary | null
  refreshKey?: number
}>()

const memory = ref<MemorySummary | null>(null)
const loading = ref(false)
const error = ref('')
const open = ref(false)

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function shortTx(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`
}

const explorerBase = computed(() => {
  const chainId = props.agent?.walletChainId ?? 421614
  return chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
})

async function load() {
  const name = props.agent?.name
  if (!name) {
    memory.value = null
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    memory.value = await fetchMemory(name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    memory.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.agent?.name, load, { immediate: true })
watch(() => props.refreshKey, () => { void load() })

const stats = computed(() => memory.value?.stats ?? null)
const topTools = computed(() => {
  if (!stats.value) return []
  return Object.entries(stats.value.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
})
</script>

<template>
  <section class="card stats" data-testid="agent-stats">
    <div class="sub-section">
      <button
        type="button"
        class="title-toggle"
        @click="open = !open"
        :aria-expanded="open ? 'true' : 'false'"
        title="Toggle Chat Stats section"
      >
        <span class="chev" :class="{ closed: !open }" aria-hidden="true">▾</span>
        <span class="sub-title">Chat Stats</span>
      </button>

      <div v-show="open" class="collapsible-body">
    <p v-if="!agent?.name" class="hint">Select an agent to see its stats.</p>

    <template v-else>
      <p v-if="loading && !memory" class="hint pulse">Loading stats…</p>
      <p v-else-if="error" class="banner">{{ error }}</p>

      <template v-else-if="memory">
        <div v-if="memory.empty" class="empty">
          <p class="empty-title">No history yet</p>
          <p class="hint">
            This agent has no <code>memory.json</code> history. Chat to create the first checkpoint — it persists to
            <code>agents/{{ agent.name }}/memory.json</code>.
          </p>
          <ul class="empty-meta mono">
            <li>threads: {{ memory.threads.length || 0 }}</li>
            <li>checkpoints: {{ memory.checkpointCount }}</li>
          </ul>
        </div>

        <template v-else>
          <div class="grid">
            <div class="stat">
              <span class="k">Messages</span>
              <span class="v">{{ stats?.totalMessages }}</span>
              <span class="sub mono">{{ stats?.humanCount }} you · {{ stats?.aiCount }} agent · {{ stats?.toolCount }} tool</span>
            </div>
            <div class="stat">
              <span class="k">Sessions</span>
              <span class="v">{{ memory.sessions.length }}</span>
              <span class="sub mono">{{ memory.checkpointCount }} checkpoint{{ memory.checkpointCount !== 1 ? 's' : '' }}</span>
            </div>
            <div class="stat">
              <span class="k">Last active</span>
              <span class="v mono small">{{ timeAgo(memory.lastActive) }}</span>
              <span v-if="memory.lastActive" class="sub mono" :title="memory.lastActive">{{ new Date(memory.lastActive).toLocaleString() }}</span>
            </div>
            <div class="stat">
              <span class="k">ETH moved</span>
              <span class="v mono">{{ stats && Number(stats.totalEthSent) > 0 ? (Number(stats.totalEthSent).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ETH') : '—' }}</span>
            </div>
          </div>

          <div v-if="topTools.length" class="chips">
            <span v-for="[name, n] in topTools" :key="name" class="chip mono" :title="`${name} called ${n} times`">
              <span class="chip-name">{{ name }}</span>
              <span class="chip-count">×{{ n }}</span>
            </span>
          </div>

          <div class="lists">
            <div v-if="stats?.uniqueRecipients.length" class="list-block">
              <span class="list-label">Recipients ({{ stats?.uniqueRecipients.length ?? 0 }})</span>
              <div class="addr-list">
                <a
                  v-for="a in stats.uniqueRecipients.slice(0, 6)"
                  :key="a"
                  class="mono addr"
                  :href="`${explorerBase}/address/${a}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="a"
                  >{{ shortAddr(a) }} ↗</a
                >
                <span v-if="(stats.uniqueRecipients.length ?? 0) > 6" class="mono more">+{{ (stats.uniqueRecipients.length ?? 0) - 6 }} more</span>
              </div>
            </div>

            <div v-if="memory.recentTxHashes.length" class="list-block">
              <span class="list-label">Recent txs ({{ stats?.txHashes.length ?? memory.recentTxHashes.length }})</span>
              <div class="addr-list">
                <a
                  v-for="h in memory.recentTxHashes.slice(0, 5)"
                  :key="h"
                  class="mono addr"
                  :href="`${explorerBase}/tx/${h}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="h"
                  >{{ shortTx(h) }} ↗</a
                >
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.hint { margin: 0; font-size: 0.82rem; color: var(--muted); line-height: 1.45; }
.hint code { font-family: var(--font-mono); font-size: 0.78em; background: color-mix(in oklab, var(--border) 60%, transparent); padding: 0.12em 0.3em; border-radius: 0.25em; }
.banner { margin: 0; padding: 0.55rem 0.65rem; background: color-mix(in oklab, var(--warn) 12%, var(--surface)); color: var(--warn); font-size: 0.82rem; border: 1px solid var(--border); border-radius: 0.4rem; word-break: break-all; }
.pulse { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:.5}50%{opacity:1}}
.empty { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem 0.75rem; border: 1px dashed var(--border); border-radius: 0.45rem; background: color-mix(in oklab, var(--bg) 60%, var(--surface)); }
.empty-title { margin: 0; font-size: 0.85rem; font-weight: 600; }
.empty-meta { margin: 0; display: flex; gap: 0.8rem; font-size: 0.72rem; color: var(--muted); list-style: none; padding: 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.stat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.65rem; border: 1px solid var(--border); border-radius: 0.45rem; background: var(--bg); min-width: 0; }
.stat .k { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.stat .v { font-size: 1rem; font-weight: 700; line-height: 1.1; color: var(--ink); }
.stat .v.small { font-size: 0.85rem; }
.stat .sub { font-size: 0.68rem; color: var(--muted); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.22rem 0.5rem; border-radius: 999px; background: var(--surface-2, color-mix(in oklab, var(--border) 45%, var(--surface))); border: 1px solid var(--border); font-size: 0.72rem; }
.chip-name { color: var(--ink); }
.chip-count { color: var(--muted); font-weight: 600; }
.lists { display: flex; flex-direction: column; gap: 0.55rem; }
.list-block { display: flex; flex-direction: column; gap: 0.3rem; }
.list-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.addr-list { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.addr { font-size: 0.73rem; color: var(--accent); text-decoration: none; padding: 0.18rem 0.4rem; border: 1px solid color-mix(in oklab, var(--accent) 20%, var(--border)); border-radius: 0.3rem; background: color-mix(in oklab, var(--accent) 6%, var(--surface)); }
.addr:hover { text-decoration: underline; }
.more { font-size: 0.72rem; color: var(--muted); }
.title-toggle { display: inline-flex; align-items: center; gap: 0.4rem; background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; }
.sub-section { display: flex; flex-direction: column; gap: 0.6rem; }
.sub-title { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.chev { font-size: 0.75rem; color: var(--muted); transition: transform 0.15s ease; }
.chev.closed { transform: rotate(-90deg); }
.collapsible-body { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
