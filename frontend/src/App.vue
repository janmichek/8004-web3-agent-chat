<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import WalletBar from './components/WalletBar.vue'
import AgentPicker from './components/AgentPicker.vue'
import AgentMemory from './components/AgentMemory.vue'
import AgentStats from './components/AgentStats.vue'
import AgentChat from './components/AgentChat.vue'
import CreateAgent from './components/CreateAgent.vue'
import type { AgentSummary, MemorySession } from './api'

function networkSlug(chainId: number): string {
  if (chainId === 42161) return 'arbitrum-one'
  if (chainId === 421614) return 'arbitrum-sepolia'
  return 'arbitrum-sepolia'
}

const selectedAgent = ref<AgentSummary | null>(null)
const refreshKey = ref(0)
const showCreate = ref(false)
const showConvos = ref(false)
const pendingSelect = ref<string | null>(null)
const recalledSession = ref<MemorySession | null>(null)
const queryClient = useQueryClient()

function extractNumericId(agentId: string): string {
  const parts = agentId.split(':')
  return parts[parts.length - 1] || agentId
}

const scanId = computed(() => {
  if (!selectedAgent.value?.agentId) return null
  return extractNumericId(selectedAgent.value.agentId)
})

const scanUrl = computed(() => {
  if (!scanId.value) return null
  const slug = networkSlug(selectedAgent.value!.walletChainId)
  return `https://testnet.8004scan.io/agents/${slug}/${scanId.value}`
})

function onSelect(agent: AgentSummary | null) {
  selectedAgent.value = agent
  recalledSession.value = null
  if (agent && agent.name === pendingSelect.value) {
    pendingSelect.value = null
  }
}

function onFunded() {
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}

function onDeleted(_name: string) {
  selectedAgent.value = null
  recalledSession.value = null
  pendingSelect.value = null
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}

function onMemoryChat() {
  refreshKey.value += 1
}

function onRecall(session: MemorySession) {
  recalledSession.value = session
  // keep the Conversations panel open so the selection stays visible
}

function toggleConvos() {
  showConvos.value = !showConvos.value
}

function onNewChat() {
  recalledSession.value = null
}

function onCreated(agent: AgentSummary) {
  showCreate.value = false
  selectedAgent.value = agent
  pendingSelect.value = agent.name
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}

function onDialogKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showCreate.value) showCreate.value = false
}

onMounted(() => window.addEventListener('keydown', onDialogKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onDialogKeydown))
</script>

<template>
  <div class="shell">
    <WalletBar />

    <main class="layout">
      <aside class="side">
        <AgentPicker
          :select-name="pendingSelect"
          :agent="selectedAgent"
          :scan-id="scanId"
          :scan-url="scanUrl"
          :refresh-key="refreshKey"
          @select="onSelect"
          @create="showCreate = true"
          @funded="onFunded"
          @deleted="onDeleted"
        />

        <AgentStats :agent="selectedAgent" :refresh-key="refreshKey" />
      </aside>

      <div class="main">
        <div class="main-toolbar">
          <button
            type="button"
            class="btn ghost convo-btn"
            :aria-expanded="showConvos ? 'true' : 'false'"
            :aria-pressed="showConvos ? 'true' : 'false'"
            @click="toggleConvos"
          >
            <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span>
            Conversations
          </button>
        </div>

        <div class="main-body">
          <div v-show="showConvos" class="convos">
            <AgentMemory :agent="selectedAgent" :refresh-key="refreshKey" @recall="onRecall" @new-chat="onNewChat" />
          </div>

          <div class="chat-col">
            <AgentChat
              :agent="selectedAgent"
              :recalled-session="recalledSession"
              @chat="onMemoryChat"
            />
          </div>
        </div>
      </div>
    </main>

    <Teleport to="body">
      <div
        v-if="showCreate"
        class="dialog-backdrop"
        @click.self="showCreate = false"
      >
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Create agent">
          <CreateAgent @created="onCreated" @cancel="showCreate = false" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(16rem, 21rem) 1fr;
  max-width: none;
  width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1.25rem 2rem;
}

/* strip card chrome inside aside -> plain sections */
.side :deep(.card),
.side :deep(.panel) {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
}

.main-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: none;
  flex-shrink: 0;
}

.convo-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.burger {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
}
.burger i {
  display: block;
  width: 14px;
  height: 2px;
  background: currentColor;
  border-radius: 2px;
}
.stats-icon {
  font-size: 0.9rem;
  line-height: 1;
}
.convo-btn[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}

.main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.convos {
  width: min(17rem, 30%);
  min-width: 13rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-self: stretch;
  border-right: none;
  overflow: hidden;
  padding: 1rem 1rem 1rem;
}

/* strip card chrome inside conversations drawer */
.convos :deep(.card) {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.chat-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem 1.25rem 0.5rem;
}

/* chat itself stays borderless full-height */
.chat-col :deep(.chat) {
  border: none;
  border-radius: 0;
  background: transparent;
}
.chat-col :deep(.thread) {
  background: transparent;
  padding: 1rem 0.25rem;
}
.chat-col :deep(.composer) {
  background: transparent;
  border-top: none;
  padding-left: 0;
  padding-right: 0;
  padding-bottom: 0;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgb(4 8 12 / 0.65);
  backdrop-filter: blur(4px);
}

.dialog {
  width: min(36rem, 100%);
  max-height: min(42rem, 90vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.5);
}

/* wizard fills the dialog instead of acting as its own card */
.dialog :deep(.wizard) {
  border: none;
  border-radius: 0;
  background: transparent;
  min-height: 0;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .side {
    overflow: visible;
    border-bottom: 1px solid var(--border);
  }
  .main {
    border-left: none;
    min-height: 30rem;
  }
  .convos {
    position: absolute;
    z-index: 20;
    background: var(--bg);
    height: 100%;
    width: min(20rem, 85%);
    box-shadow: 8px 0 24px rgb(0 0 0 / 0.4);
  }
  .main-body {
    position: relative;
  }
}
</style>
