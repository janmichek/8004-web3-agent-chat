<script setup lang="ts">
import type { MemorySummary } from '@/shared/api'

defineProps<{
  agentName: string
  memory: MemorySummary
}>()
</script>

<template>
  <div class="empty">
    <p class="empty-title">No history yet</p>
    <p class="hint">
      This agent has no <code>memory.json</code> history. Chat to create the first checkpoint — it persists to
      <code>agents/{{ agentName }}/memory.json</code>.
    </p>
    <ul class="empty-meta mono">
      <li>threads: {{ memory.threads.length || 0 }}</li>
      <li>checkpoints: {{ memory.checkpointCount }}</li>
    </ul>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 0.45rem;
  background: color-mix(in oklab, var(--bg) 60%, var(--surface));
}
.empty-title { margin: 0; font-size: 0.85rem; font-weight: 600; }
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.45;
}
.hint code {
  font-family: var(--font-mono);
  font-size: 0.78em;
  background: color-mix(in oklab, var(--border) 60%, transparent);
  padding: 0.12em 0.3em;
  border-radius: 0.25em;
}
.empty-meta { margin: 0; display: flex; gap: 0.8rem; font-size: 0.72rem; color: var(--muted); list-style: none; padding: 0; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
