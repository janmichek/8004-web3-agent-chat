<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import WalletBar from './wallet-bar/WalletBar.vue'
import AgentPicker from './agent-picker/AgentPicker.vue'
import AgentMemory from './agent-memory/AgentMemory.vue'
import AgentStats from './agent-stats/AgentStats.vue'
import AgentChat from './agent-chat/AgentChat.vue'
import CreateAgent from './create-agent/CreateAgent.vue'
import { ModalDialog } from '@/shared/ui'
import { type AgentSummary, type MemorySession } from '@/shared/api'

const selectedAgent = ref<AgentSummary | null>(null)
/** False until the first agent list lands, so "no agent" copy never flashes on load. */
const agentsLoaded = ref(false)
const refreshKey = ref(0)
const showCreate = ref(false)
const showStats = ref(false)
/** Narrow screens only: the conversations sidebar becomes an off-canvas drawer. */
const showSide = ref(false)
const narrowQuery = window.matchMedia('(max-width: 860px)')
const narrow = ref(narrowQuery.matches)
const pendingSelect = ref<string | null>(null)
const recalledSession = ref<MemorySession | null>(null)
/** Bumped when the narrow conversations drawer closes without a new recall, to replay chat pop-in. */
const chatReplayKey = ref(0)
/** Bumped by "+ New chat" so a live thread is cleared even when nothing was recalled. */
const newChatKey = ref(0)
const queryClient = useQueryClient()

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
  const same = recalledSession.value?.id === session.id
  recalledSession.value = session
  showSide.value = false
  // Same session: watcher won't rebuild bubbles, so replay pop-in explicitly.
  if (same) chatReplayKey.value += 1
}

function syncNarrow() {
  narrow.value = narrowQuery.matches
  if (!narrow.value) showSide.value = false
}

function toggleSide() {
  if (showSide.value) chatReplayKey.value += 1
  showSide.value = !showSide.value
}

function onNewChat() {
  recalledSession.value = null
  newChatKey.value += 1
  showSide.value = false
}

function onCreated(agent: AgentSummary) {
  showCreate.value = false
  selectedAgent.value = agent
  pendingSelect.value = agent.name
  refreshKey.value += 1
  void queryClient.invalidateQueries()
}

function onDialogKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && narrow.value && showSide.value) showSide.value = false
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
  <div class="shell">
    <WalletBar>
      <template #menu>
        <button
          type="button"
          class="icon-btn side-toggle"
          data-testid="convos-toggle"
          aria-label="Conversations"
          :aria-expanded="showSide ? 'true' : 'false'"
          aria-controls="convos-panel"
          @click="toggleSide"
        >
          <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
      </template>
    </WalletBar>

    <main class="layout">
      <button
        v-if="narrow && showSide"
        type="button"
        class="side-backdrop"
        aria-label="Close conversations"
        @click="toggleSide"
      />

      <aside
        id="convos-panel"
        class="side"
        :class="{ open: showSide }"
        :aria-hidden="narrow && !showSide ? 'true' : undefined"
        :inert="narrow && !showSide"
      >
        <AgentPicker
          :select-name="pendingSelect"
          :agent="selectedAgent"
          :refresh-key="refreshKey"
          @select="onSelect"
          @create="showCreate = true"
          @funded="onFunded"
          @deleted="onDeleted"
          @loaded="agentsLoaded = true"
        />

        <header class="side-head side-head-convos">
          <h2 class="side-title">Conversations</h2>
          <button
            type="button"
            class="btn ghost small"
            data-testid="new-chat-btn"
            title="New chat"
            :disabled="!selectedAgent?.name"
            @click="onNewChat"
          >
            + New chat
          </button>
        </header>
        <AgentMemory :agent="selectedAgent" :refresh-key="refreshKey" :new-chat-key="newChatKey" @recall="onRecall" @stats="showStats = true" />
      </aside>

      <section class="main">
        <div class="chat-col">
          <AgentChat
            :agent="selectedAgent"
            :recalled-session="recalledSession"
            :replay-key="chatReplayKey"
            :new-chat-key="newChatKey"
            :agents-loaded="agentsLoaded"
            @chat="onMemoryChat"
          />
        </div>
      </section>
    </main>

    <ModalDialog v-if="showStats" title="Chat stats" @close="showStats = false">
      <AgentStats :agent="selectedAgent" :refresh-key="refreshKey" />
    </ModalDialog>

    <ModalDialog v-if="showCreate" headless size="lg" label="Create agent" @close="showCreate = false">
      <CreateAgent @created="onCreated" @cancel="showCreate = false" />
    </ModalDialog>
  </div>
</template>

<style scoped src="@/shared/ui/icon-button.css"></style>

<style scoped>
.shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
  width: 100%;
}

/* Left: conversations */
.side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  overflow: visible;
  padding: 1rem 1rem 1rem 1.25rem;
  border-right: 1px solid var(--border);
}
.side :deep(.card) {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.side-head-convos {
  margin-top: 0.5rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border);
}
/* Matches the uppercase section labels used across the app. */
.side-title {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.side-toggle {
  display: none;
  color: var(--ink);
}
.side-toggle:hover {
  background: var(--surface-2);
}
.side-toggle[aria-expanded='true'] {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, transparent);
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

/* Right: agent select + chat */
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.chat-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0.5rem 1.25rem 0.5rem;
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

.side-backdrop {
  position: absolute;
  inset: 0;
  z-index: 41;
  border: 0;
  padding: 0;
  background: var(--backdrop);
  cursor: pointer;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .side-toggle {
    display: inline-flex;
  }
  .side {
    position: absolute;
    z-index: 42;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(20rem, calc(100% - 2.75rem));
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
  .chat-col {
    padding: 0.5rem 0.85rem 0.35rem;
  }
}
</style>
