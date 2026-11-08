<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AgentSummary, MemorySession } from '@/shared/api'
import { timeAgo } from '@/shared/lib'
import MemoryEmptyState from '../memory/MemoryEmptyState.vue'
import { useAgentMemory } from '../../model/use-agent-memory'

const props = defineProps<{
  agent?: AgentSummary | null
  refreshKey?: number
  newChatKey?: number
}>()

const emit = defineEmits<{
  recall: [session: MemorySession]
}>()

const selectedId = ref<string | null>(null)
const { memory, sessions, loading, error } = useAgentMemory(() => props.agent, () => props.refreshKey)

watch(() => props.newChatKey, () => {
  selectedId.value = null
})

watch(() => props.agent?.name, () => {
  selectedId.value = null
})

// Drop the selection when the reloaded memory no longer contains that session.
watch(memory, (m) => {
  if (selectedId.value && m && !m.sessions.some(s => s.id === selectedId.value)) {
    selectedId.value = null
  }
})

function onRecall(s: MemorySession) {
  selectedId.value = s.id
  emit('recall', s)
}

</script>

<template>
  <section class="card memory" data-testid="agent-memory">
    <p v-if="!agent?.name" class="hint">Select an agent to see its on-disk memory.</p>

    <template v-else>
      <p v-if="loading && !memory" class="hint pulse">Loading memory…</p>
      <p v-else-if="error" class="banner">{{ error }}</p>

      <template v-else-if="memory">
        <!-- Empty state with meaningful hint derived from file absence -->
        <MemoryEmptyState v-if="memory.empty" :agent-name="agent.name" :memory="memory" />

        <template v-else>
          <div v-if="!sessions.length" class="hint">No sessions detected.</div>

          <div v-else class="session-list" role="list">
            <button
              v-for="s in sessions"
              :key="s.id"
              role="listitem"
              type="button"
              class="session-card"
              :class="{ selected: selectedId === s.id }"
              :aria-selected="selectedId === s.id ? 'true' : 'false'"
              :title="`Recall conversation from ${timeAgo(s.startedAt)}`"
              @click="onRecall(s)"
            >
              <div class="session-preview" :title="s.preview">“{{ s.preview }}”</div>
              <div class="session-head">
                <span class="session-time mono">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {{ timeAgo(s.startedAt) }}
                </span>
              </div>
            </button>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped src="../memory/memory-status.css"></style>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.mono { font-family: var(--font-mono, ui-monospace, monospace); }

/* 1px top room so the hover lift (translateY(-1px)) isn't clipped by overflow. */
.session-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 1px;
  padding-right: 0.2rem;
  padding-bottom: 0.5rem;
  scrollbar-width: thin;
}

.session-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid color-mix(in oklab, var(--border) 85%, transparent);
  border-radius: 0.6rem;
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(var(--shadow-rgb) / 0.04);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
  width: 100%;
  font: inherit;
  color: inherit;
}

.session-card:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  box-shadow: 0 4px 12px rgb(var(--shadow-rgb) / 0.09);
  transform: translateY(-1px);
}

.session-card:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
  outline-offset: 1px;
}

.session-card.selected {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent),
    0 4px 12px rgb(var(--shadow-rgb) / 0.09);
}

.session-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.session-time {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.68rem;
  color: var(--muted);
}

.session-preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.8rem;
  color: color-mix(in oklab, var(--ink) 75%, var(--muted));
  line-height: 1.4;
  overflow: hidden;
  overflow-wrap: anywhere;
}
</style>
