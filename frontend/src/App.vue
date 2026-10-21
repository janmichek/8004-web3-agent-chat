<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { Web3AuthProvider } from '@web3auth/modal/vue'
import { WagmiProvider } from '@web3auth/modal/vue/wagmi'
import WalletBar from './components/WalletBar.vue'
import AgentPicker from './components/AgentPicker.vue'
import AgentMemory from './components/AgentMemory.vue'
import AgentStats from './components/AgentStats.vue'
import AgentChat from './components/AgentChat.vue'
import CreateAgent from './components/CreateAgent.vue'
import web3AuthContextConfig from './web3authContext'
import { scanUrlForAgent, type AgentSummary, type MemorySession } from './api'

const selectedAgent = ref<AgentSummary | null>(null)
const refreshKey = ref(0)
const showCreate = ref(false)
const showConvos = ref(false)
const showSide = ref(false)
const narrowQuery = window.matchMedia('(max-width: 860px)')
const narrow = ref(narrowQuery.matches)
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
  const agent = selectedAgent.value
  if (!agent?.agentId) return null
  return scanUrlForAgent(agent.agentId, agent.walletChainId)
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
  showConvos.value = false
}

function syncNarrow() {
  narrow.value = narrowQuery.matches
  if (!narrow.value) showSide.value = false
}

function toggleSide() {
  showSide.value = !showSide.value
  if (showSide.value) showConvos.value = false
}

function toggleConvos() {
  showConvos.value = !showConvos.value
  if (showConvos.value) showSide.value = false
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
  if (e.key !== 'Escape') return
  if (showCreate.value) {
    showCreate.value = false
    return
  }
  if (narrow.value && showSide.value) showSide.value = false
}

onMounted(() => {
  window.addEventListener('keydown', onDialogKeydown)
  narrowQuery.addEventListener('change', syncNarrow)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDialogKeydown)
  narrowQuery.removeEventListener('change', syncNarrow)
})
</script>

<template>
  <Web3AuthProvider :config="web3AuthContextConfig">
    <WagmiProvider>
      <div class="shell">
        <WalletBar>
          <template #menu>
            <button
              type="button"
              class="side-toggle"
              data-testid="agent-panel-toggle"
              aria-label="Agent"
              :aria-expanded="showSide ? 'true' : 'false'"
              aria-controls="agent-panel"
              @click="toggleSide"
            >
              <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span>
            </button>
          </template>
        </WalletBar>

        <main class="layout">
          <div class="main-toolbar">
            <button
              type="button"
              class="convo-btn"
              :aria-expanded="showConvos ? 'true' : 'false'"
              :aria-pressed="showConvos ? 'true' : 'false'"
              @click="toggleConvos"
            >
              <span class="caret" :class="{ open: showConvos }" aria-hidden="true">▸</span>
              Conversations
            </button>
          </div>

          <div class="stage">
            <button
              v-if="narrow && showSide"
              type="button"
              class="side-backdrop"
              aria-label="Close agent panel"
              @click="showSide = false"
            />

            <aside
              id="agent-panel"
              class="side"
              :class="{ open: showSide }"
              :aria-hidden="narrow && !showSide ? 'true' : undefined"
              :inert="narrow && !showSide"
            >
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

            <div class="main-body">
              <div class="convos" :class="{ open: showConvos }" :inert="!showConvos">
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
    </WagmiProvider>
  </Web3AuthProvider>
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
  grid-template-rows: auto minmax(0, 1fr);
  max-width: none;
  width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* Stage is a pass-through on desktop so the sidebar spans both rows. */
.stage {
  display: contents;
}

.side {
  grid-column: 1;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1.25rem 2rem;
  border-right: 1px solid var(--border);
}

/* strip card chrome inside aside -> plain sections */
.side :deep(.card),
.side :deep(.panel) {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.main-toolbar {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: none;
  flex-shrink: 0;
  background: transparent;
}

.side-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.side-toggle:hover {
  background: var(--surface-2);
}
.side-toggle[aria-expanded='true'] {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, transparent);
}

.convo-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0.15rem 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.convo-btn {
  padding: 0.3rem 0.6rem;
  border-radius: 2rem;
  transition: color 0.18s ease;
}
.convo-btn:hover {
  background: none;
  color: var(--ink);
  text-decoration: none;
}
.caret {
  display: inline-block;
  font-size: 0.72rem;
  line-height: 1;
  text-decoration: none;
  transition: transform 0.25s var(--ease-spring);
}
.convo-btn:hover .caret {
  text-decoration: none;
}
.caret.open {
  transform: rotate(90deg);
}

.burger {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
}
.burger i {
  transition: transform 0.25s var(--ease-spring), opacity 0.2s ease;
  display: block;
  width: 14px;
  height: 2px;
  background: currentColor;
  border-radius: 2px;
}
.side-toggle[aria-expanded='true'] .burger i:nth-child(1) { transform: translateY(5px) rotate(45deg); }
.side-toggle[aria-expanded='true'] .burger i:nth-child(2) { opacity: 0; }
.side-toggle[aria-expanded='true'] .burger i:nth-child(3) { transform: translateY(-5px) rotate(-45deg); }
.stats-icon {
  font-size: 0.9rem;
  line-height: 1;
}
.convo-btn[aria-pressed='true'] {
  color: var(--ink);
}

.main-body {
  grid-column: 2;
  grid-row: 2;
  position: relative;
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
  background: var(--backdrop);
  backdrop-filter: blur(4px);
  animation: fade-bg 0.25s ease both;
}
@keyframes fade-bg {
  from { opacity: 0; }
}

.dialog {
  width: min(46rem, 100%);
  max-height: min(46rem, 90vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 24px 64px rgb(var(--shadow-rgb) / 0.5), 0 0 0 1px color-mix(in oklab, var(--accent) 10%, transparent);
  animation: dialog-in 0.45s var(--ease-spring) both;
}
@keyframes dialog-in {
  from { opacity: 0; transform: translateY(1.5rem) scale(0.94); }
}

/* wizard fills the dialog instead of acting as its own card */
.dialog :deep(.wizard) {
  border: none;
  border-radius: 0;
  background: transparent;
  min-height: 0;
}

.side-backdrop {
  position: absolute;
  inset: 0;
  z-index: 25;
  border: 0;
  padding: 0;
  background: var(--backdrop);
  cursor: pointer;
}

/* Closed conversations panel slides off the chat, then drops out of hit testing. */
@media (min-width: 861px) {
  .convos:not(.open) {
    position: absolute;
    z-index: 20;
    top: 0;
    bottom: 0;
    left: 0;
    background: var(--bg);
    box-shadow: 8px 0 24px rgb(var(--shadow-rgb) / 0.35);
    transform: translateX(-105%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.22s ease, visibility 0s linear 0.22s;
  }
}

@media (max-width: 860px) {
  .layout {
    position: relative;
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .main-toolbar {
    grid-column: 1;
    grid-row: 1;
    position: relative;
    z-index: 40;
  }
  .side-toggle {
    display: inline-flex;
  }
  /* Static so the agent drawer positions against .layout and covers the toolbar. */
  .stage {
    display: block;
    position: static;
    grid-column: 1;
    grid-row: 2;
    min-height: 0;
    overflow: visible;
  }
  .side-backdrop {
    z-index: 41;
  }
  .side {
    position: absolute;
    z-index: 42;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(22rem, calc(100% - 2.75rem));
    border-right: 1px solid var(--border);
    background: var(--bg);
    transform: translateX(-105%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.2s ease, visibility 0s linear 0.2s;
  }
  .side.open {
    transform: none;
    visibility: visible;
    pointer-events: auto;
    box-shadow: 12px 0 32px rgb(var(--shadow-rgb) / 0.45);
    transition: transform 0.2s ease, visibility 0s;
  }
  .main-body {
    height: 100%;
  }
  .chat-col {
    padding: 0.75rem 0.85rem 0.35rem;
  }
  .convos {
    position: absolute;
    z-index: 20;
    top: 0;
    left: 0;
    background: var(--bg);
    height: 100%;
    width: min(20rem, 85%);
    box-shadow: 8px 0 24px rgb(var(--shadow-rgb) / 0.4);
    transform: translateX(-105%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.22s ease, visibility 0s linear 0.22s;
  }
  .convos.open {
    transform: none;
    visibility: visible;
    pointer-events: auto;
    transition: transform 0.22s ease, visibility 0s;
  }
}
</style>
