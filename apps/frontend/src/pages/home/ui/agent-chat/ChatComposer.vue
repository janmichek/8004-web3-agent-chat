<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { isSubmitKey } from '../../model/chat-composer-keys'

const props = withDefaults(
  defineProps<{
    placeholder: string
    /** No agent selected: the field is inert. */
    noAgent?: boolean
    /** A reply is pending: the field locks, then refocuses when it settles. */
    busy?: boolean
    variant?: 'hero' | 'dock'
  }>(),
  { noAgent: false, busy: false, variant: 'dock' },
)

const value = defineModel<string>({ required: true })
const emit = defineEmits<{ submit: [] }>()

const field = ref<HTMLTextAreaElement | null>(null)
const locked = computed(() => props.noAgent || props.busy)
const canSend = computed(() => !locked.value && value.value.trim().length > 0)

function resize() {
  const el = field.value
  if (!el) return
  el.style.height = ''
  el.style.height = `${el.scrollHeight}px`
}

watch(value, () => void nextTick(resize))

watch(
  () => props.busy,
  (busy, wasBusy) => {
    if (wasBusy && !busy) void nextTick(() => field.value?.focus())
  },
)

function onKeydown(e: KeyboardEvent) {
  if (!isSubmitKey(e)) return
  e.preventDefault()
  if (canSend.value) emit('submit')
}
</script>

<template>
  <form
    class="composer"
    :class="[`composer--${variant}`, { 'composer--inert': noAgent }]"
    data-testid="chat-composer"
    @submit.prevent="canSend && emit('submit')"
  >
    <textarea
      ref="field"
      v-model="value"
      rows="1"
      class="composer-input"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :disabled="locked"
      data-testid="chat-input"
      @keydown="onKeydown"
    />
    <button
      type="submit"
      class="composer-send"
      aria-label="Send message"
      data-testid="chat-send"
      :disabled="!canSend"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 16V4m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </form>
</template>

<style scoped>
/* One flat bar: a single border, one radius, a centred row. The textarea and
   button share the same vertical centre so the send button never looks dropped. */
.composer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 3rem;
  padding: 0.35rem 0.35rem 0.35rem 1.15rem;
  border: 1px solid color-mix(in oklab, var(--ink) 16%, var(--border));
  border-radius: 1rem;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--ink) 4%, var(--surface)),
    var(--surface)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--ink) 8%, transparent),
    0 6px 18px -12px rgb(0 0 0 / 0.5);
  transition:
    border-color 0.2s ease,
    box-shadow 0.25s ease,
    opacity 0.2s ease;
}

.composer:hover:not(.composer--inert) {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
}

.composer:focus-within {
  border-color: var(--accent);
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--ink) 8%, transparent),
    0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent),
    0 8px 28px -14px var(--glow);
}

.composer--hero {
  width: min(46rem, 94%);
  margin: 0.9rem auto 0;
  min-height: 3.5rem;
  padding: 0.45rem 0.45rem 0.45rem 1.4rem;
}

.composer--dock {
  margin: 0.6rem 0.75rem 0.75rem;
}

.composer--inert {
  opacity: 0.6;
}

.composer-input {
  flex: 1;
  min-width: 0;
  margin: 0;
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--ink);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  padding: 0.5rem 0;
  max-height: 10rem;
  overflow-y: auto;
}

/* The pill owns the focus ring; cancel the global textarea ring/border. */
.composer-input,
.composer-input:hover:not(:disabled),
.composer-input:focus {
  border: none;
  box-shadow: none;
}

.composer-input::placeholder {
  color: var(--muted);
  opacity: 0.85;
}

.composer-input:disabled {
  cursor: not-allowed;
}

.composer-send {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 0.7rem;
  background: linear-gradient(
    160deg,
    color-mix(in oklab, var(--accent) 80%, white),
    var(--accent)
  );
  color: var(--on-accent);
  box-shadow: 0 4px 12px -4px var(--glow);
  cursor: pointer;
  transition:
    transform 0.15s var(--ease-out),
    filter 0.15s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.composer-send svg {
  width: 1.1rem;
  height: 1.1rem;
}

.composer-send:not(:disabled):hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.composer-send:not(:disabled):active {
  transform: scale(0.94);
}

.composer-send:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.composer-send:disabled {
  background: transparent;
  border-color: var(--border);
  box-shadow: none;
  color: var(--muted);
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .composer--dock {
    margin: 0.5rem;
  }
}
</style>
