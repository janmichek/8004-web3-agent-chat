<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AgentSummary } from '../api'

const props = defineProps<{
  agents: AgentSummary[]
  modelValue: string
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [name: string]
  create: []
  open: []
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(0)

const selected = computed(() => props.agents.find((a) => a.name === props.modelValue) ?? null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.agents
  return props.agents.filter((a) => {
    const haystack = [
      a.name,
      a.description,
      a.agentId,
      ...a.tools,
      ...a.actions,
      ...(a.services?.map((s) => s.name) ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

/** Options are the filtered agents plus a permanent "Create agent" row. */
const itemCount = computed(() => filtered.value.length + 1)
const createIndex = computed(() => filtered.value.length)

watch([filtered, () => props.agents], () => {
  if (activeIndex.value >= itemCount.value) activeIndex.value = Math.max(0, itemCount.value - 1)
})

watch(query, () => {
  activeIndex.value = 0
})

function openMenu() {
  if (open.value) return
  open.value = true
  query.value = ''
  const index = filtered.value.findIndex((a) => a.name === props.modelValue)
  activeIndex.value = index >= 0 ? index : 0
  emit('open')
  void nextTick(() => searchInput.value?.focus())
}

function closeMenu(returnFocus = false) {
  if (!open.value) return
  open.value = false
  query.value = ''
  if (returnFocus) void nextTick(() => trigger.value?.focus())
}

function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu()
}

function choose(name: string) {
  emit('update:modelValue', name)
  closeMenu(true)
}

function chooseCreate() {
  closeMenu()
  emit('create')
}

function move(delta: number) {
  if (!itemCount.value) return
  activeIndex.value = (activeIndex.value + delta + itemCount.value) % itemCount.value
  void nextTick(() => {
    document.getElementById(optionId(activeIndex.value))?.scrollIntoView({ block: 'nearest' })
  })
}

function activate(index: number) {
  if (index === createIndex.value) chooseCreate()
  else {
    const agent = filtered.value[index]
    if (agent) choose(agent.name)
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    activeIndex.value = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    activeIndex.value = itemCount.value - 1
  } else if (e.key === 'Enter') {
    e.preventDefault()
    activate(activeIndex.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeMenu(true)
  } else if (e.key === 'Tab') {
    closeMenu()
  }
}

function optionId(index: number): string {
  return `agent-option-${index}`
}

function onDocumentPointerDown(e: PointerEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))

function initials(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AG'
}

function avatarStyle(name: string): Record<string, string> {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  const from = `hsl(${hash} 62% 42%)`
  const to = `hsl(${(hash + 48) % 360} 58% 30%)`
  return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }
}

function hideBrokenImage(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'never'
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

function usageLabel(agent: AgentSummary): string {
  if (!agent.lastActive) return 'No conversations yet'
  const messages = agent.messageCount ?? 0
  const usage = messages
    ? `${messages} message${messages === 1 ? '' : 's'}`
    : `${agent.sessionCount ?? 0} session${(agent.sessionCount ?? 0) === 1 ? '' : 's'}`
  return `Last used ${relativeTime(agent.lastActive)} · ${usage}`
}

function triggerSubtitle(agent: AgentSummary | null): string {
  if (!agent) return props.agents.length ? 'Choose an agent' : 'Create your first agent'
  return usageLabel(agent)
}
</script>

<template>
  <div ref="root" class="agent-select">
    <button
      ref="trigger"
      type="button"
      class="trigger"
      data-testid="agent-select"
      :data-value="modelValue"
      aria-label="Select agent"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      aria-controls="agent-listbox"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu"
      @keydown.up.prevent="openMenu"
      @keydown.esc="closeMenu()"
    >
      <span class="avatar" :style="avatarStyle(selected?.name ?? 'agent')" aria-hidden="true">
        <img v-if="selected?.image" :src="selected.image" alt="" @error="hideBrokenImage" />
        <span v-else class="initials">{{ initials(selected?.name ?? 'agent') }}</span>
      </span>
      <span class="trigger-copy">
        <span class="trigger-name">{{ selected?.name ?? 'No agent selected' }}</span>
        <span class="trigger-meta">{{ triggerSubtitle(selected) }}</span>
      </span>
      <span v-if="selected?.active" class="live-dot" title="Agent is active" aria-label="Active" />
      <span class="chev" :class="{ open }" aria-hidden="true">▾</span>
    </button>

    <Transition name="drop">
      <div v-if="open" class="menu" data-testid="agent-menu">
        <div class="search-row">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input
            ref="searchInput"
            v-model="query"
            class="search"
            data-testid="agent-search"
            type="text"
            role="combobox"
            aria-label="Search agents"
            aria-autocomplete="list"
            aria-controls="agent-listbox"
            :aria-activedescendant="optionId(activeIndex)"
            placeholder="Search agents, tools, capabilities…"
            autocomplete="off"
            spellcheck="false"
            @keydown="onSearchKeydown"
          />
          <span v-if="loading" class="spinner" aria-label="Refreshing" />
          <kbd v-else class="esc">esc</kbd>
        </div>

        <ul id="agent-listbox" class="list" role="listbox" aria-label="Agents">
          <li
            v-for="(agent, index) in filtered"
            :id="optionId(index)"
            :key="agent.name"
            class="option"
            :class="{ active: index === activeIndex, selected: agent.name === modelValue }"
            role="option"
            :aria-selected="agent.name === modelValue"
            :data-testid="`agent-option-${agent.name}`"
            :data-agent-name="agent.name"
            @mousemove="activeIndex = index"
            @click="choose(agent.name)"
          >
            <span class="avatar option-avatar" :style="avatarStyle(agent.name)" aria-hidden="true">
              <img v-if="agent.image" :src="agent.image" alt="" @error="hideBrokenImage" />
              <span v-else class="initials">{{ initials(agent.name) }}</span>
            </span>
            <span class="option-copy">
              <span class="option-title">
                <span class="option-name">{{ agent.name }}</span>
                <span v-if="agent.active" class="live-dot small" title="Agent is active" />
              </span>
              <span class="option-meta" :title="agent.lastActive ?? 'No conversations yet'">{{ usageLabel(agent) }}</span>
            </span>
          </li>

          <li
            v-if="!filtered.length"
            class="no-results"
            role="presentation"
          >
            No agents match “{{ query }}”
          </li>
        </ul>

        <div class="menu-foot">
          <button
            :id="optionId(createIndex)"
            type="button"
            class="create-btn"
            :class="{ active: createIndex === activeIndex }"
            data-testid="agent-create-option"
            @mousemove="activeIndex = createIndex"
            @click="chooseCreate"
          >
            <span class="create-icon" aria-hidden="true">+</span>
            <span class="create-copy">
              <span class="create-title">Create agent</span>
              <span class="create-sub">Deploy a new ERC-8004 agent</span>
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.agent-select {
  position: relative;
  width: 100%;
}

.trigger {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  margin: 0;
  padding: 0.55rem 0.65rem;
  font: inherit;
  text-align: left;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.trigger:hover {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  background: color-mix(in oklab, var(--accent) 4%, var(--bg));
}
.trigger:focus-visible,
.trigger[aria-expanded='true'] {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent);
}

.avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  overflow: hidden;
  border-radius: 0.55rem;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
}
.avatar img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.initials {
  line-height: 1;
}

.trigger-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}
.trigger-name {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trigger-meta {
  font-size: 0.7rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-dot {
  width: 0.45rem;
  height: 0.45rem;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--ok-ink);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ok-ink) 18%, transparent);
}
.live-dot.small {
  width: 0.35rem;
  height: 0.35rem;
  box-shadow: none;
}

.chev {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--muted);
  transition: transform 0.2s var(--ease-spring);
}
.chev.open {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 0.4rem);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  max-height: min(22rem, 54vh);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  box-shadow: 0 18px 48px rgb(var(--shadow-rgb) / 0.42), 0 0 0 1px color-mix(in oklab, var(--accent) 10%, transparent);
}

.search-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid var(--border);
}
.search-icon {
  font-size: 1rem;
  color: var(--muted);
  line-height: 1;
}
.search {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  font: inherit;
  font-size: 0.84rem;
  color: var(--ink);
  background: none;
  border: 0;
  outline: none;
  box-shadow: none;
}
.search:hover,
.search:focus,
.search:focus-visible {
  border: 0;
  outline: none;
  box-shadow: none;
}
.search::placeholder {
  color: var(--muted);
}
.esc {
  font-size: 0.62rem;
  color: var(--muted);
  padding: 0.12rem 0.3rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
}
.spinner {
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid color-mix(in oklab, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.option {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  border-radius: 0.45rem;
  cursor: pointer;
  transition: background 0.12s ease;
}
.option.active {
  background: color-mix(in oklab, var(--accent) 12%, var(--surface));
}
.option.selected {
  background: color-mix(in oklab, var(--accent) 8%, var(--surface));
}
.option.selected.active {
  background: color-mix(in oklab, var(--accent) 16%, var(--surface));
}

.option-avatar {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 0.6rem;
}
.option-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}
.option-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.option-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-meta {
  min-width: 0;
  font-size: 0.66rem;
  color: color-mix(in oklab, var(--muted) 80%, var(--ink));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-results {
  padding: 0.9rem 0.7rem;
  font-size: 0.76rem;
  color: var(--muted);
  text-align: center;
}

.menu-foot {
  position: sticky;
  bottom: 0;
  z-index: 1;
  flex-shrink: 0;
  padding: 0.4rem;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  margin: 0;
  padding: 0.45rem 0.5rem;
  font: inherit;
  text-align: left;
  color: var(--on-accent);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0.45rem;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
}
.create-btn:hover,
.create-btn.active {
  background: color-mix(in oklab, var(--accent) 88%, #000);
  border-color: color-mix(in oklab, var(--accent) 88%, #000);
}
.create-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent);
}
.create-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.7rem;
  height: 1.7rem;
  font-size: 1.05rem;
  font-weight: 500;
  line-height: 1;
  border-radius: 0.5rem;
  color: inherit;
  background: rgb(255 255 255 / 0.18);
}
.create-copy {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}
.create-title {
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.2;
}
.create-sub {
  font-size: 0.66rem;
  color: color-mix(in oklab, var(--on-accent) 78%, transparent);
  line-height: 1.2;
}

.drop-enter-active,
.drop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s var(--ease-out);
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-0.3rem) scale(0.985);
}
</style>
