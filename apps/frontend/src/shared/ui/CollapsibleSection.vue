<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ title: string }>()

const open = ref(false)
</script>

<template>
  <div class="sub-section">
    <button
      type="button"
      class="title-toggle"
      @click="open = !open"
      :aria-expanded="open ? 'true' : 'false'"
      :title="`Toggle ${title} section`"
    >
      <span class="chev" :class="{ closed: !open }" aria-hidden="true">▾</span>
      <span class="sub-title">{{ title }}</span>
    </button>

    <Transition name="collapse">
      <div v-if="open" class="collapsible-body">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.sub-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.title-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.sub-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.chev {
  display: inline-block;
  font-size: 0.75rem;
  color: var(--muted);
  transition: transform 0.25s var(--ease-spring);
}
.chev.closed {
  transform: rotate(-90deg);
}
.collapsible-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.collapsible-body :deep(> *) {
  animation: collapse-row-in 0.4s var(--ease-out) both;
}
.collapsible-body :deep(> *:nth-child(2)) {
  animation-delay: 0.04s;
}
.collapsible-body :deep(> *:nth-child(3)) {
  animation-delay: 0.08s;
}
.collapsible-body :deep(> *:nth-child(4)) {
  animation-delay: 0.12s;
}
.collapsible-body :deep(> *:nth-child(5)) {
  animation-delay: 0.16s;
}
.collapsible-body :deep(> *:nth-child(6)) {
  animation-delay: 0.2s;
}
.collapsible-body :deep(> *:nth-child(n + 7)) {
  animation-delay: 0.24s;
}
.collapse-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s var(--ease-out);
}
.collapse-leave-to {
  opacity: 0;
  transform: translateX(-0.35rem);
}
@keyframes collapse-row-in {
  from {
    opacity: 0;
    transform: translateX(-0.5rem);
  }
}
</style>
