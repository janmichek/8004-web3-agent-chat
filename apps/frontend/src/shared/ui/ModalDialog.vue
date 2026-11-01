<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = defineProps<{
  /** Visible heading. Omit for `headless` dialogs that bring their own header. */
  title?: string
  /** Accessible name; falls back to `title`. */
  label?: string
  size?: 'md' | 'lg'
  headless?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click.self="emit('close')">
      <div
        class="dialog"
        :class="props.size ?? 'md'"
        role="dialog"
        aria-modal="true"
        :aria-label="props.label ?? props.title"
      >
        <header v-if="!props.headless" class="dialog-head">
          <h2>{{ props.title }}</h2>
          <button type="button" class="dialog-close" aria-label="Close" data-testid="dialog-close" @click="emit('close')">
            ✕
          </button>
        </header>
        <div class="dialog-body" :class="{ headless: props.headless }">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--backdrop);
  animation: fade-bg 0.25s ease both;
}
@keyframes fade-bg {
  from { opacity: 0; }
}

.dialog {
  width: min(28rem, 100%);
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
.dialog.lg {
  width: min(46rem, 100%);
}
@keyframes dialog-in {
  from { opacity: 0; transform: translateY(1.5rem) scale(0.94); }
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1.1rem;
  border-bottom: 1px solid var(--border);
}
.dialog-head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}
.dialog-close {
  margin: 0;
  padding: 0.25rem 0.45rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}
.dialog-close:hover {
  color: var(--ink);
  background: var(--surface-2);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 0;
  overflow-y: auto;
  padding: 1.1rem;
}
/* headless dialogs (wizard) fill the dialog and manage their own padding/scroll */
.dialog-body.headless {
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.dialog-body.headless > :deep(.wizard) {
  border: none;
  border-radius: 0;
  background: transparent;
  min-height: 0;
}
</style>
