<script setup lang="ts">
import { computed } from 'vue'
import type { AgentSummary } from '@/shared/api'
import { networkInfo } from '@/shared/config'
import { shortAddr, shortTx, timeAgo } from '@/shared/lib'
import MemoryEmptyState from '../memory/MemoryEmptyState.vue'
import { useAgentMemory } from '../../model/use-agent-memory'

const props = defineProps<{
  agent?: AgentSummary | null
  refreshKey?: number
}>()

const { memory, loading, error } = useAgentMemory(() => props.agent, () => props.refreshKey)

const explorerBase = computed(() => networkInfo(props.agent?.walletChainId).explorerUrl)

const stats = computed(() => memory.value?.stats ?? null)
const topTools = computed(() => {
  if (!stats.value) return []
  return Object.entries(stats.value.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
})
</script>

<template>
  <section class="stats" data-testid="agent-stats">
    <p v-if="!agent?.name" class="hint">Select an agent to see its stats.</p>

    <template v-else>
      <p v-if="loading && !memory" class="hint pulse">Loading stats…</p>
      <p v-else-if="error" class="banner">{{ error }}</p>

      <template v-else-if="memory">
        <MemoryEmptyState v-if="memory.empty" :agent-name="agent.name" :memory="memory" />

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
  </section>
</template>

<style scoped src="../memory/memory-status.css"></style>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 0.75rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.stat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.65rem; border: 1px solid var(--border); border-radius: 0.45rem; background: var(--bg); min-width: 0; animation: row-in 0.4s var(--ease-out) both; }
.stat:nth-child(2) { animation-delay: 0.04s; }
.stat:nth-child(3) { animation-delay: 0.08s; }
.stat:nth-child(4) { animation-delay: 0.12s; }
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
@keyframes row-in {
  from { opacity: 0; transform: translateX(-0.5rem); }
}
</style>
