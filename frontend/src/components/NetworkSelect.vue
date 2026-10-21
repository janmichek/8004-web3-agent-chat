<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NetworkIcon from './NetworkIcon.vue'

export type NetworkOption = {
  chainId: number
  name: string
  /** Compact secondary label (e.g. catalog network slug). */
  network?: string
}

const props = defineProps<{
  modelValue: number
  networks: NetworkOption[]
  disabled?: boolean
  /** Accessible name for the trigger. */
  ariaLabel?: string
  /** Test id prefix; trigger is `${testId}`, options `${testId}-option-${chainId}`. */
  testId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [chainId: number]
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const activeIndex = ref(0)

const testId = computed(() => props.testId ?? 'network-select')
const selected = computed(
  () => props.networks.find((n) => n.chainId === props.modelValue) ?? props.networks[0],
)

const canOpen = computed(() => !props.disabled && props.networks.length > 1)

watch(
  () => props.modelValue,
  () => {
    const idx = props.networks.findIndex((n) => n.chainId === props.modelValue)
    if (idx >= 0) activeIndex.value = idx
  },
)

function closeMenu() {
  open.value = false
}

async function openMenu() {
  if (!canOpen.value) return
  open.value = true
  const idx = props.networks.findIndex((n) => n.chainId === props.modelValue)
  activeIndex.value = idx >= 0 ? idx : 0
  await nextTick()
}

function toggleMenu() {
  if (open.value) closeMenu()
  else void openMenu()
}

function choose(chainId: number) {
  emit('update:modelValue', chainId)
  closeMenu()
  trigger.value?.focus()
}

function optionId(index: number) {
  return `${testId.value}-opt-${index}`
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void openMenu()
  } else if (event.key === 'Escape') {
    closeMenu()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleMenu()
  }
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    trigger.value?.focus()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % props.networks.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value =
      (activeIndex.value - 1 + props.networks.length) % props.networks.length
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const n = props.networks[activeIndex.value]
    if (n) choose(n.chainId)
  }
}

function onDocPointerDown(event: PointerEvent) {
  if (!open.value || !root.value) return
  const target = event.target as Node | null
  if (target && !root.value.contains(target)) closeMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})
</script>

<template>
  <div ref="root" class="network-select" :class="{ open, disabled }">
    <button
      ref="trigger"
      type="button"
      class="trigger"
      :data-testid="testId"
      :data-value="String(modelValue)"
      :disabled="disabled || networks.length === 0"
      :aria-label="ariaLabel ?? 'Network'"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="`${testId}-listbox`"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <NetworkIcon v-if="selected" :chain-id="selected.chainId" :size="22" />
      <span class="trigger-copy">
        <span class="trigger-name">{{ selected?.name ?? 'Select network' }}</span>
        <span v-if="selected?.network" class="trigger-meta">{{ selected.network }}</span>
      </span>
      <svg
        v-if="canOpen"
        class="chevron"
        :class="{ open }"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4.2 6.2 8 10l3.8-3.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <Transition name="drop">
      <ul
        v-if="open"
        :id="`${testId}-listbox`"
        class="list"
        role="listbox"
        :aria-label="ariaLabel ?? 'Network'"
        tabindex="-1"
        @keydown="onListKeydown"
      >
        <li
          v-for="(n, index) in networks"
          :id="optionId(index)"
          :key="n.chainId"
          class="option"
          :class="{ active: index === activeIndex, selected: n.chainId === modelValue }"
          role="option"
          :aria-selected="n.chainId === modelValue"
          :data-testid="`${testId}-option-${n.chainId}`"
          @mousemove="activeIndex = index"
          @click="choose(n.chainId)"
        >
          <NetworkIcon :chain-id="n.chainId" :size="22" />
          <span class="option-copy">
            <span class="option-name">{{ n.name }}</span>
            <span v-if="n.network" class="option-meta">{{ n.network }}</span>
          </span>
          <svg
            v-if="n.chainId === modelValue"
            class="check"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3.5 8.2 6.6 11.2 12.5 4.8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.network-select {
  position: relative;
  width: 100%;
}

.trigger {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  font: inherit;
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.55rem 0.7rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.trigger:hover:not(:disabled) {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
}

.trigger:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 45%, transparent);
  outline-offset: 1px;
}

.trigger:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.network-select.open .trigger {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent);
}

.trigger-copy {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
  flex: 1;
}

.trigger-name {
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.trigger-meta {
  font-size: 0.72rem;
  color: var(--muted);
  line-height: 1.2;
}

.chevron {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--muted);
  flex-shrink: 0;
  transition: transform 0.2s var(--ease-out, ease);
}

.chevron.open {
  transform: rotate(180deg);
  color: var(--accent);
}

.list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.35rem;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  background: var(--surface, var(--bg));
  box-shadow:
    0 14px 32px -16px rgb(var(--shadow-rgb, 0 0 0) / 0.4),
    0 0 0 1px color-mix(in oklab, var(--accent) 8%, transparent);
  max-height: 16rem;
  overflow-y: auto;
}

.option {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.6rem;
  border-radius: 0.45rem;
  cursor: pointer;
  color: var(--ink);
}

.option.active {
  background: color-mix(in oklab, var(--accent) 10%, var(--surface-2, var(--bg)));
}

.option.selected {
  background: color-mix(in oklab, var(--accent) 14%, transparent);
}

.option-copy {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
  flex: 1;
}

.option-name {
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.option-meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.check {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--accent);
  flex-shrink: 0;
}

.drop-enter-active,
.drop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s var(--ease-out, ease);
}

.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-0.3rem) scale(0.98);
}
</style>
