import { computed, ref, watch } from "vue";
import { fetchMemory, type AgentSummary, type MemorySummary } from "@/shared/api";

/**
 * Loads `memory.json` for the selected agent.
 * Reloads when the agent changes or `refreshKey` is bumped.
 */
export function useAgentMemory(
  agent: () => AgentSummary | null | undefined,
  refreshKey: () => number | undefined = () => undefined,
) {
  const memory = ref<MemorySummary | null>(null);
  const loading = ref(false);
  const error = ref("");

  /** Sessions ordered newest first, so the freshest conversation is on top. */
  const sessions = computed(() =>
    [...(memory.value?.sessions ?? [])].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    ),
  );

  async function load() {
    const name = agent()?.name;
    if (!name) {
      memory.value = null;
      error.value = "";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      memory.value = await fetchMemory(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      memory.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch(() => agent()?.name, load, { immediate: true });
  watch(refreshKey, () => {
    void load();
  });

  return { memory, sessions, loading, error, load };
}
